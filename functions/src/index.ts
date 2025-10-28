import * as functions from 'firebase-functions';
import {onRequest, Request} from 'firebase-functions/v2/https';

import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';

import Firestore = firestore.Firestore;
import GeoPoint = firestore.GeoPoint;
import Timestamp = firestore.Timestamp;
import {GcMessagingService} from './gc-messaging-service';

import {GcGeoService} from './gc-geo-service';
import {geohashQueryBounds, Geopoint} from 'geofire-common';
import {Bid, Call, CallsSearchCriteria, GeohashCallsSearchRequest, GeohashCallsSearchResponse, GeohashResponse, Models, ResponseBody} from './models';
import SetOptions = firestore.SetOptions;
import {onObjectDeleted, onObjectFinalized} from 'firebase-functions/v2/storage';
import FieldValue = firestore.FieldValue;
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';

admin.initializeApp();
const db = getFirestore();
const storage = getStorage();
// admin.initializeApp(functions.config().firebase);
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const BUCKET_NAME = 'dinger-cash-344019.appspot.com';

exports.stripePayment = onRequest(async (req: Request, res) => {
    const secretKey = process.env.STRIPE_TESTKEY as string;
    const apiVersionDate = '2025-09-30.clover';

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
                    business_id: req.body.business_id
                };
                customer = await stripe.customers.update(customer.id, updateParams);
            }
            customerId = customer.id;
        } else {
            const customer = await stripe.customers.create({
                name: req.body.names,
                email: req.body.email,
                metadata: {business_id: req.body.business_id}
            });
            customerId = customer.id;
        }

        stripe.ephemeralKeys.create({customer: customerId}, {apiVersion: apiVersionDate})
            .then((key) => {
                stripe.paymentIntents.create({
                    amount: parseFloat(req.body.amount),
                    currency: req.body.currency,
                    customer: customerId,
                    metadata: {
                        customer_business_id: req.body.business_id
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
        functions.logger.error('An error occurred!', {message: message});
        res.status(401).send({success: false, message: message} as ResponseBody);
    }
});

exports.onCallExpired = onRequest(async (req: Request, res) => {
    const nodeType = req.body.type;
    if (nodeType !== 'call') {
        res.status(401).send({success: false, message: 'Node expiration: Type not allowed'} as ResponseBody);
    }
    const nodeUuid = req.body.uuid;
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const huchaToken = process.env.HUCHA_TOKEN;
    const huchaHost = process.env.HUCHA_HOST;
    const backendUrl = `${huchaHost}/expire-node/${huchaToken}`;
    const backedPayload = {uuid: nodeUuid, type: nodeType};

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
                Accept: 'application/json',
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
        functions.logger.error('Expiring node failed: ', {message: message});
        res.status(401).send({success: false, message: message} as ResponseBody);
    }
});

exports.onBidCreated = onRequest(async (req: Request, res) => {
    const bid = req.body as Bid;
    try {
        const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
        const firestore = new Firestore({projectId: projectId});
        await firestore.collection('live_bids').doc(bid.id).set({
            status: bid.status,
            type: bid.type,
            call_id: bid.callId,
            call_amount: bid.callAmount,
            caller_id: bid.caller.id,
            caller_name: bid.caller.lastname,
            caller_photo: bid.caller.photo,
            bidder_id: bid.bidder.id,
            bidder_name: bid.bidder.lastname,
            bidder_photo: bid.bidder.photo,
            bargain_amount: bid.bargainAmount,
            created_at: Timestamp.now()
        });
        functions.logger.info(`Bid ${bid.id} created successfully`);
        functions.logger.info('### Fetching device id for customer {}', bid.caller.id);
        const messagingService = new GcMessagingService();
        const data = new Map<string, string>([
            ['call_id', bid.callId]
        ]);
        switch (bid.type) {
            case 'accept':
                await firestore.collection('live_calls').doc(bid.callId).set({status: 'attributed'}, {merge: true} as SetOptions);
                await messagingService.sendNotification(
                    bid.caller.id,
                    'bidAccepted',
                    {
                        title: 'Delivery accepted',
                        body: 'A bid to accept your call has been placed now.'
                    } as Notification,
                    data);
                break;
            case 'bargain':
                await messagingService.sendNotification(
                    bid.caller.id,
                    'newBid',
                    {
                        title: 'A new bid placed',
                        body: `A new bid of ${bid.bargainAmount} Euro has been placed now.`
                    } as Notification,
                    data);
                break;
        }
        res.status(201).send({success: true, message: 'Bid created successfully'} as ResponseBody);
    } catch (e) {
        functions.logger.error(`Bid ${bid.id} creation failed`, e);
        // @ts-ignore
        res.status(404).send({success: false, message: e.toString()} as ResponseBody);
    }
});

exports.onBargainPlaced = onRequest(async (req: Request, res) => {
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
            functions.logger.info(`Bargain of ${bargainData.bargain_reply_amount} Euro placed on Bid ${bidId}`);
        }
        res.status(201).send({success: true, message: 'Bargain placed successfully'} as ResponseBody);
    } catch (e) {
        functions.logger.error(`Bargain placement on Bid ${bidId} failed`);
        // @ts-ignore
        res.status(401).send({success: false, message: e.toString()} as ResponseBody);
    }

});

exports.onBidUpdated = onRequest(async (req: Request, res) => {
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
        switch (bidStatus) {
            case 'rejected':
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
                break;
            case 'accepted':
                bidDocRef
                    .set({status: bidStatus}, {merge: true} as SetOptions)
                    .then(() => messagingService.sendNotification(
                        bidModel.bidder.id,
                        'bidAccepted',
                        {
                            title: 'Your bid has been accepted',
                            body: `Your bid of ${bidModel.bargainAmount} has been accepted.`
                        } as Notification,
                        new Map<string, string>()
                    ).catch((e) => res.status(401).send({success: false, message: e.toString()} as ResponseBody)));
                break;
            case 'confirmed':
                bidDocRef.set({status: bidStatus}, {merge: true} as SetOptions);
                firestore
                    .collection('live_calls')
                    .doc(bidModel.callId)
                    .set({
                        status: 'attributed',
                        executor_id: bidModel.bidder.id,
                        executor_photo: bidModel.bidder.photo,
                        executor_name: bidModel.bidder.lastname,
                        proposed_fee: bidModel.bargainAmount > bidModel.callAmount ? bidModel.bargainAmount : bidModel.callAmount
                    }, {merge: true} as SetOptions)
                    .then(() => messagingService.sendNotification(
                        bidModel.caller.id,
                        'bidConfirmed',
                        {
                            title: 'Order delivery confirmed',
                            body: 'Your order delivery has been confirmed by the serviceman.'
                        } as Notification,
                        new Map<string, string>([
                            ['call_id', bidModel.callId]
                        ])
                    ).catch((e) => res.status(401).send({success: false, message: e.toString()} as ResponseBody)));
                break;
            case 'renounced':
                await messagingService.sendNotification(
                    bidModel.caller.id,
                    'bidRenounced',
                    {
                        title: 'Order delivery renounced',
                        body: 'Sorry, your order delivery has been renounced.'
                    } as Notification,
                    new Map<string, string>([
                        ['call_id', bidModel.callId]
                    ])
                )
                    .then(() => bidDocRef.delete())
                    .catch((e) => res.status(401).send({success: false, message: e.toString()}));
                break;
        }
        res.status(200).send({success: true, message: 'Bargain updated successfully'} as ResponseBody);
    }
});

exports.searchCallsInArea = onRequest(async (req: Request, res) => {
    const searchCriteria = req.body as CallsSearchCriteria;
    const geoService = new GcGeoService();
    try {
        const calls: Call[] = await geoService.fetchCallsDeliverableInArea(searchCriteria);
        res.status(200).send({success: true, message: `Success!! Found ${calls.length} calls`, data: calls});
    } catch (e) {
        functions.logger.error(e);
        res.status(400).send({success: false, message: 'Bad Request. Operation failed', data: []} as ResponseBody);
    }
});

exports.computeGeoHash = onRequest(async (req: Request, res) => {
    const callsSearchRequest = req.body as GeohashCallsSearchRequest;
    try {
        const deliveryGeoPoint: GeoPoint = callsSearchRequest.deliveryAddressGeoRequest.geoPoint;
        const deliveryCenter : Geopoint = [deliveryGeoPoint.latitude, deliveryGeoPoint.longitude];
        const deliveryRadius: number = callsSearchRequest.deliveryAddressGeoRequest.radius;
        const deliveryGeo = geohashQueryBounds(deliveryCenter, deliveryRadius);
        const searchResponse: GeohashCallsSearchResponse = {deliveryAddressGeoResponse: {geohashRanges: deliveryGeo} as GeohashResponse};
        if (callsSearchRequest.pickupAddressGeoRequest !== undefined) {
            const pickupGeoPoint: GeoPoint = callsSearchRequest.pickupAddressGeoRequest.geoPoint;
            const pickupCenter: Geopoint = [pickupGeoPoint.latitude, pickupGeoPoint.longitude];
            const pickupGeo = geohashQueryBounds(pickupCenter, callsSearchRequest.pickupAddressGeoRequest.radius);
            searchResponse.pickupAddressGeoResponse = {geohashRanges: pickupGeo} as GeohashResponse;
        }
        res.status(200).send({success: true, message: 'GeoHashRanges retrieved successfully', data: searchResponse} as ResponseBody);
    } catch (e) {
        functions.logger.error(e);
        res.status(400).send({success: false, message: 'Bad Request. Operation failed', data: []} as ResponseBody);
    }
});

// Trigger when a file is uploaded/finalized
export const onFileUploaded = onObjectFinalized({region: 'europe-west1'}, async (event) => {
    const object = event.data;
    const filePath = object.name; // e.g., "profile_photos/customer-uuid.jpg"
    const bucket = object.bucket;

    console.log('File uploaded:', filePath);

    // Only process profile photos
    if (!filePath.startsWith('profile_photos/')) {
        console.log('Not a profile photo, ignoring');
        return;
    }

    const filename = filePath.split('/').pop()!;
    const customerUuid = filename.split('.')[0];

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(filePath)}?alt=media`;

    try {
        // Fetch all documents that need updating
        const [bidderBids, callerBids, calls] = await Promise.all([
            db.collection('live_bids').where('bidder_id', '==', customerUuid).get(),
            db.collection('live_bids').where('caller_id', '==', customerUuid).get(),
            db.collection('live_calls').where('caller_id', '==', customerUuid).get()
        ]);

        // Use batch writes for efficiency
        const batch = db.batch();

        // Update live_bids as bidder
        bidderBids.docs.forEach(doc => {
            batch.update(doc.ref, {
                bidder_photo: publicUrl
            });
        });

        // Update live_bids as caller
        callerBids.docs.forEach(doc => {
            batch.update(doc.ref, {
                caller_photo: publicUrl
            });
        });

        // Update live_calls as caller
        calls.docs.forEach(doc => {
            batch.update(doc.ref, {
                caller_photo: publicUrl
            });
        });

        await batch.commit();

        console.log(`Updated customer and ${bidderBids.size} bidder_bids, ${callerBids.size} caller_bids, ${calls.size} calls`);
    } catch (error) {
        console.error('Error updating Firestore:', error);
    }
});

// Trigger when a file is deleted
export const onFileDeleted = onObjectDeleted({region: 'europe-west1'}, async (event) => {
    const object = event.data;
    const filePath = object.name;

    if (!filePath.startsWith('profile_photos/')) {
        return;
    }

    const filename = filePath.split('/').pop()!;
    const customerUuid = filename.split('.')[0];

    try {
        // Remove bidder_photo from live_bids where bidder_id = customerUuid
        const bidderBidsSnapshot = await db.collection('live_bids')
            .where('bidder_id', '==', customerUuid)
            .get();

        const bidderBidsUpdates = bidderBidsSnapshot.docs.map(doc =>
            doc.ref.update({
                bidder_photo: FieldValue.delete()
            })
        );
        await Promise.all(bidderBidsUpdates);
        console.log(`Removed bidder_photo from ${bidderBidsSnapshot.size} live_bids`);

        // Remove caller_photo from live_bids where caller_id = customerUuid
        const callerBidsSnapshot = await db.collection('live_bids')
            .where('caller_id', '==', customerUuid)
            .get();

        const callerBidsUpdates = callerBidsSnapshot.docs.map(doc =>
            doc.ref.update({
                caller_photo: FieldValue.delete()
            })
        );
        await Promise.all(callerBidsUpdates);
        console.log(`Removed caller_photo from ${callerBidsSnapshot.size} live_bids`);

        // Remove caller_photo from live_calls where caller_id = customerUuid
        const callsSnapshot = await db.collection('live_calls')
            .where('caller_id', '==', customerUuid)
            .get();

        const callsUpdates = callsSnapshot.docs.map(doc =>
            doc.ref.update({
                caller_photo: FieldValue.delete()
            })
        );
        await Promise.all(callsUpdates);
        console.log(`Removed caller_photo from ${callsSnapshot.size} live_calls`);
    } catch (error) {
        console.error('Error updating Firestore:', error);
    }
});

/**
 * More efficient helper - finds photo with any extension using prefix search
 */
async function getProfilePhotoUrl(userId: string): Promise<string | null> {
    const bucket = storage.bucket(BUCKET_NAME);
    const prefix = `profile_photos/${userId}.`;

    try {
        const [files] = await bucket.getFiles({prefix, maxResults: 1});

        if (files.length > 0) {
            const file = files[0];
            const filePath = file.name;
            const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(filePath)}?alt=media`;
            console.log(`Found photo for user ${userId}: ${filePath}`);
            return publicUrl;
        }
    } catch (error) {
        console.error(`Error finding photo for user ${userId}:`, error);
    }

    console.log(`No photo found for user ${userId}`);
    return null;
}

/**
 * Trigger when a document is created in live_bids
 * Check for bidder and caller photos and update the document
 */
export const onLiveBidCreated = onDocumentCreated(
    {
        document: 'live_bids/{bidId}',
        region: 'europe-west1'
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) {
            console.log('No data associated with the event');
            return;
        }

        const bidData = snapshot.data();
        const bidId = event.params.bidId;
        const bidderId = bidData.bidder_id;
        const callerId = bidData.caller_id;

        console.log(`New bid created: ${bidId}, bidder: ${bidderId}, caller: ${callerId}`);

        const updates: { [key: string]: string } = {};

        // Check for bidder photo
        if (bidderId) {
            const bidderPhotoUrl = await getProfilePhotoUrl(bidderId);
            if (bidderPhotoUrl) {
                updates.bidder_photo = bidderPhotoUrl;
                console.log(`Setting bidder_photo for bid ${bidId}`);
            }
        }

        // Check for caller photo
        if (callerId) {
            const callerPhotoUrl = await getProfilePhotoUrl(callerId);
            if (callerPhotoUrl) {
                updates.caller_photo = callerPhotoUrl;
                console.log(`Setting caller_photo for bid ${bidId}`);
            }
        }

        // Update document if we found any photos
        if (Object.keys(updates).length > 0) {
            try {
                await db.collection('live_bids').doc(bidId).update(updates);
                console.log(`Updated bid ${bidId} with photos:`, updates);
            } catch (error) {
                console.error(`Error updating bid ${bidId}:`, error);
            }
        } else {
            console.log(`No photos found for bid ${bidId}`);
        }
    }
);

/**
 * Trigger when a document is created in live_calls
 * Check for caller photo and update the document
 */
export const onLiveCallCreated = onDocumentCreated(
    {
        document: 'live_calls/{callId}',
        region: 'europe-west1'
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) {
            console.log('No data associated with the event');
            return;
        }

        const callData = snapshot.data();
        const callId = event.params.callId;
        const callerId = callData.caller_id;

        console.log(`New call created: ${callId}, caller: ${callerId}`);

        if (!callerId) {
            console.log(`No caller_id found for call ${callId}`);
            return;
        }

        // Check for caller photo
        const callerPhotoUrl = await getProfilePhotoUrl(callerId);

        if (callerPhotoUrl) {
            try {
                await db.collection('live_calls').doc(callId).update({
                    caller_photo: callerPhotoUrl
                });
                console.log(`Updated call ${callId} with caller_photo: ${callerPhotoUrl}`);
            } catch (error) {
                console.error(`Error updating call ${callId}:`, error);
            }
        } else {
            console.log(`No photo found for caller ${callerId} in call ${callId}`);
        }
    }
);
