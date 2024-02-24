import * as functions from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";

import {Request, Response} from "firebase-functions";
import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';

import Firestore = firestore.Firestore;
import GeoPoint = firestore.GeoPoint;
import Timestamp = firestore.Timestamp;
import {GcTasksService} from "./gc-tasks-service";
import {GcMessagingService} from "./gc-messaging-service";

import {GcGeoService} from "./gc-geo-service";
import {geohashForLocation, geohashQueryBounds} from "geofire-common";
// eslint-disable-next-line import/namespace
import {Bid, Call, CallsSearchCriteria, GeohashCallsSearchRequest, GeohashCallsSearchResponse, GeohashResponse, Models, ResponseBody} from "./models";


// admin.initializeApp(functions.config().firebase);
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

exports.stripePayment = onRequest(async (req: Request, res: Response) => {
    const secretKey = process.env.STRIPE_TESTKEY as string;
    const apiVersionDate = '2023-10-16';

    const stripe = new Stripe(secretKey, {
        apiVersion: apiVersionDate, typescript: true
    });

    try {
        let customerId: string;
        const customerList = await stripe.customers.list({
            email: req.body.email,
            limit: 1
        });

        if (customerList.data.length !== 0) {
            let customer = customerList.data[0];
            if (customer.name == null || customer.name.length === 0) {
                const updateParams = {} as Stripe.CustomerUpdateParams;
                updateParams.name = req.body.names;
                updateParams.metadata = {
                    'business_id': req.body.business_id
                };
                customer = await stripe.customers.update(customer.id, updateParams);
            }
            customerId = customer.id;
        } else {
            const customer = await stripe.customers.create({
                    name: req.body.names,
                    email: req.body.email,
                    metadata: {
                        'business_id': req.body.business_id
                    }
                }
            );
            customerId = customer.id;
        }

        stripe.ephemeralKeys.create({customer: customerId}, {apiVersion: apiVersionDate})
            .then((key) => {
                stripe.paymentIntents.create({
                    amount: parseFloat(req.body.amount),
                    currency: req.body.currency,
                    customer: customerId,
                    metadata: {
                        'customer_business_id': req.body.business_id
                    }
                }).then((intent) => {
                    res.json({
                        paymentIntent: intent.client_secret,
                        ephemeralKey: key.secret,
                        customerId: customerId,
                        success: true
                    });
                }).catch((error) => {
                    functions.logger.error(error);
                });
            });

    } catch (error) {
        let message: string;
        if (error instanceof Stripe.errors.StripeError) {
            message = error.message;
        } else {
            // @ts-ignore
            message = error.toString();
        }
        functions.logger.error("An error occurred!", {message: message});
        res.status(401).send({success: false, message: message} as ResponseBody);
    }
});

exports.onCallExpired = onRequest(async (req: Request, res: Response) => {
    const nodeType = req.body.type;
    if (nodeType !== 'call') {
        res.status(401).send({success: false, message: 'Node expiration: Type not allowed'} as ResponseBody);
    }
    const nodeUuid = req.body.uuid;
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const huchaToken = process.env.HUCHA_TOKEN;
    const huchaHost = process.env.HUCHA_HOST;
    const backendUrl = `${huchaHost}/expire-node/${huchaToken}`;
    const backedPayload = {'uuid': nodeUuid, 'type': nodeType};

    const firestore = new Firestore({projectId: projectId});
    try {
        /** Delete live call and related bids **/
        const callReference = firestore.collection('live_calls').doc(nodeUuid);
        await firestore.collection('live_bids')
            .where('call_id', '==', nodeUuid)
            .get()
            .then((bids) => bids.forEach((bid) => bid.ref.delete()));
        await callReference.delete();

        /** Expire node in backend **/
            // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fetch = require('node-fetch');
        functions.logger.info(`Calling backend to expire node. Type: ${backedPayload.type} | Uuid: ${backedPayload.uuid}`);
        fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(backedPayload)
        })
            .then((res: Response) => res.json())
            .then((text: string) => functions.logger.info(`Node ${nodeUuid} of type ${nodeType} expired successfully. Message: ${text}`))
            .catch((err: never) => functions.logger.error(err));
    } catch (e) {
        // @ts-ignore
        const message = e.toString();
        functions.logger.error("Expiring node failed: ", {message: message});
        res.status(401).send({success: false, message: message} as ResponseBody);
    }
});

exports.onCallCreated = onRequest(async (req: Request, res: Response) => {
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const fireNodeExpirationFunc = process.env.FIRE_NODE_EXPIRATION_FUNC ?? '';
    const call = req.body as Call;
    try {
        const firestore = new Firestore({projectId: projectId});
        const order = call.order;
        await firestore.collection('live_calls').doc(call.id).set({
            delivery_address: new GeoPoint(order.deliveryAddressLat, order.deliveryAddressLng),
            delivery_address_full: order.deliveryAddress,
            delivery_address_geo_hash: geohashForLocation([order.deliveryAddressLat, order.deliveryAddressLng]),
            pickup_address: order.hasPickupAddress ? new GeoPoint(order.pickupAddressLat ?? 0, order.pickupAddressLng ?? 0) : null,
            pickup_address_full: order.pickupAddress ?? '',
            pickup_address_geo_hash: order.hasPickupAddress ? geohashForLocation([order.pickupAddressLat ?? 0, order.pickupAddressLng ?? 0]) : null,
            expiration_time: Timestamp.fromMillis(call.expirationTime),
            order_id: order.id,
            order_type: order.type,
            caller_id: call.caller.id,
            caller_photo: call.caller.photo,
            caller_name: call.caller.lastname
        });
        functions.logger.info(`Live Call ${call.id} created successfully`);

        /** Create GC task **/
        try {
            const payload = Buffer.from(JSON.stringify({'uuid': call.id, 'type': 'call'})).toString('base64');
            const taskName = await (new GcTasksService()).createGcTask(payload, fireNodeExpirationFunc, call.expirationTime);
            functions.logger.info(`Task ${taskName} created successfully for call: ${call.id}`);
            res.status(201).send({success: true, message: 'Call created successfully'} as ResponseBody);
        } catch (e) {
            functions.logger.error('Creating task failed: ', e);
            // @ts-ignore
            res.status(404).send({success: false, message: `Creating call task failed: ${e.toString()}`} as ResponseBody);
        }
    } catch (e) {
        functions.logger.error(`Live Call ${call.id} creation failed: `, e);
        // @ts-ignore
        res.status(404).send({success: false, message: e.toString()} as ResponseBody);
    }
});

exports.onBidCreated = onRequest(async (req: Request, res: Response) => {
    const bid = req.body as Bid;
    try {
        const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
        const firestore = new Firestore({projectId: projectId});
        await firestore.collection('live_bids').doc(bid.id).set({
            status: bid.status,
            call_id: bid.callId,
            call_amount: bid.proposedAmount,
            caller_id: bid.caller.id,
            caller_name: bid.caller.lastname,
            caller_photo: bid.caller.photo,
            bidder_id: bid.bidder.id,
            bidder_name: bid.bidder.lastname,
            bidder_photo: bid.bidder.photo,
            call_can_bargain: bid.callCanBargain,
            bargain_amount: bid.bargainAmount,
            bargain_reply_amount: bid.bargainReplyAmount,
            created_at: Timestamp.now()
        });
        functions.logger.info(`Bid ${bid.id} created successfully`);
        functions.logger.info('### Fetching device id for customer {}', bid.caller.id);
        const messagingService = new GcMessagingService();
        const data = new Map<string, string>([
            ['call_id', bid.callId]
        ]);
        await messagingService.sendNotification(
            bid.caller.id,
            'newBid',
            {
                title: 'A new bid placed',
                body: `A new bid of ${bid.bargainAmount} Euro has been placed now.`
            } as Notification,
            data);
        res.status(201).send({success: true, message: 'Bid created successfully'} as ResponseBody);
    } catch (e) {
        functions.logger.error(`Bid ${bid.id} creation failed`, e);
        // @ts-ignore
        res.status(404).send({success: false, message: e.toString()} as ResponseBody);
    }
});

exports.onBargainPlaced = onRequest(async (req: Request, res: Response) => {
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const bidId = req.body.id;
    const isExecutorBargain = req.body.isExecutorBargain;
    let bargainData: object;
    if (isExecutorBargain) {
        bargainData = {bargain_amount: req.body.bargain_amount};
    } else {
        bargainData = {bargain_reply_amount: req.body.bargainReplyAmount};
    }
    try {
        const firestore = new Firestore({projectId: projectId});
        await firestore.collection('live_bids').doc(bidId).set(bargainData, {merge: true});
        if (isExecutorBargain) {
            // @ts-ignore
            functions.logger.info(`Bargain of ${bargainData.bargain_amount} Euro placed on bid ${bidId}`);
        } else {
            // @ts-ignore
            functions.logger.info(`Bargain of ${bargainData.bargain_reply_amount} Euro placed on Bid ${bid.id}`);
        }
        res.status(201).send({success: true, message: 'Bargain placed successfully'} as ResponseBody);
    } catch (e) {
        functions.logger.error(`Bargain placement on Bid ${bidId} failed`);
        // @ts-ignore
        res.status(401).send({success: false, message: e.toString()} as ResponseBody);
    }

});

exports.onBidUpdated = onRequest(async (req: Request, res: Response) => {
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const bidId = req.body.id;
    const bidStatus = req.body.status;

    const firestore = new Firestore({projectId: projectId});
    const bidDocRef = firestore.collection('live_bids').doc(bidId);
    const bid = await bidDocRef.get();
    const bidData = bid.data();
    if (bidData !== undefined) {
        const bidModel = Models.toBid(bid.id, bidData);
        const messagingService = new GcMessagingService();
        if (bidStatus == 'rejected') {
            await messagingService.sendNotification(
                bidModel.bidder.id,
                'bidRejected',
                {
                    title: 'Your bid has been rejected',
                    body: `Your bid of ${bidModel.bargainAmount} has been rejected.`
                } as Notification,
                new Map<string, string>()
            )
                .then(() => bidDocRef.delete())
                .catch((e) => res.status(401).send({success: false, message: e.toString()} as ResponseBody));
        }

        if (bidStatus == 'accepted') {
            bidDocRef
                .update({'status': bidStatus})
                .then(() => messagingService.sendNotification(
                    bidModel.bidder.id,
                    'bidAccepted',
                    {
                        title: 'Your bid has been accepted',
                        body: `Your bid of ${bidModel.bargainAmount} has been accepted.`
                    } as Notification,
                    new Map<string, string>()
                ).catch((e) => res.status(401).send({success: false, message: e.toString()} as ResponseBody)));
        }

        if (bidStatus == 'confirmed') {
            bidDocRef
                .update({'status': bidStatus})
                .then(() => messagingService.sendNotification(
                    bidModel.caller.id,
                    'bidConfirmed',
                    {
                        title: 'Order delivery confirmed',
                        body: `Your order delivery has been confirmed by the serviceman.`
                    } as Notification,
                    new Map<string, string>([
                        ['call_id', bidModel.callId]
                    ])
                ).catch((e) => res.status(401).send({success: false, message: e.toString()} as ResponseBody)));
        }

        if (bidStatus == 'renounced') {
            await messagingService.sendNotification(
                bidModel.caller.id,
                'bidRenounced',
                {
                    title: 'Order delivery renounced',
                    body: `Sorry, your order delivery has been renounced.`
                } as Notification,
                new Map<string, string>([
                    ['call_id', bidModel.callId]
                ])
            )
                .then(() => bidDocRef.delete())
                .catch((e) => res.status(401).send({success: false, message: e.toString()}));
        }
        res.status(200).send({success: true, message: 'Bargain updated successfully'} as ResponseBody);
    }
});

exports.searchCallsInArea = onRequest(async (req: Request, res: Response) => {
    const searchCriteria = req.body as CallsSearchCriteria;
    const geoService = new GcGeoService();
    try {
        const calls: Call[] = await geoService.fetchCallsDeliverableInArea(searchCriteria);
        res.status(200).send({success: true, message: `Success!! Found ${calls.length} calls`, data: calls});
    } catch (e) {
        functions.logger.error(e);
        res.status(400).send({success: false, message: `Bad Request. Operation failed`, data: []} as ResponseBody);
    }
});

exports.computeGeoHash = onRequest(async (req: Request, res: Response) => {
    const callsSearchRequest = req.body as GeohashCallsSearchRequest;
    try {
        const deliveryGeoPoint: GeoPoint = callsSearchRequest.deliveryAddressGeoRequest.geoPoint;
        const deliveryGeo = geohashQueryBounds([deliveryGeoPoint.latitude, deliveryGeoPoint.longitude], callsSearchRequest.deliveryAddressGeoRequest.radius);
        const searchResponse: GeohashCallsSearchResponse = {deliveryAddressGeoResponse: {geohashRanges: deliveryGeo} as GeohashResponse};
        if (callsSearchRequest.pickupAddressGeoRequest !== undefined) {
            const pickupGeoPoint: GeoPoint = callsSearchRequest.pickupAddressGeoRequest.geoPoint;
            const pickupGeo = geohashQueryBounds([pickupGeoPoint.latitude, pickupGeoPoint.longitude], callsSearchRequest.pickupAddressGeoRequest.radius);
            searchResponse.pickupAddressGeoResponse = {geohashRanges: pickupGeo} as GeohashResponse;
        }
        res.status(200).send({success: true, message: 'GeoHashRanges retrieved successfully', data: searchResponse} as ResponseBody);
    } catch (e) {
        functions.logger.error(e);
        res.status(400).send({success: false, message: 'Bad Request. Operation failed', data: []} as ResponseBody);
    }
});
