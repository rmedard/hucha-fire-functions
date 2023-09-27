"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const stripe_1 = require("stripe");
const admin = require("firebase-admin");
const firebase_admin_1 = require("firebase-admin");
var Firestore = firebase_admin_1.firestore.Firestore;
var GeoPoint = firebase_admin_1.firestore.GeoPoint;
var Timestamp = firebase_admin_1.firestore.Timestamp;
const gc_tasks_service_1 = require("./gc-tasks-service");
const gc_messaging_service_1 = require("./gc-messaging-service");
const models_1 = require("./models");
admin.initializeApp(functions.config().firebase);
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
exports.stripePayment = functions.https.onRequest(async (req, res) => {
    const secretKey = functions.config().stripe.testkey;
    const apiVersionDate = '2023-08-16';
    const stripe = new stripe_1.default(secretKey, {
        apiVersion: apiVersionDate, typescript: true
    });
    try {
        let customerId;
        const customerList = await stripe.customers.list({
            email: req.body.email,
            limit: 1
        });
        if (customerList.data.length !== 0) {
            let customer = customerList.data[0];
            if (customer.name == null || customer.name.length === 0) {
                const updateParams = {};
                updateParams.name = req.body.names;
                updateParams.metadata = {
                    'business_id': req.body.business_id
                };
                customer = await stripe.customers.update(customer.id, updateParams);
            }
            customerId = customer.id;
        }
        else {
            const customer = await stripe.customers.create({
                name: req.body.names,
                email: req.body.email,
                metadata: {
                    'business_id': req.body.business_id
                }
            });
            customerId = customer.id;
        }
        stripe.ephemeralKeys.create({ customer: customerId }, { apiVersion: apiVersionDate })
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
    }
    catch (error) {
        let message;
        if (error instanceof stripe_1.default.errors.StripeError) {
            message = error.message;
        }
        else {
            // @ts-ignore
            message = error.toString();
        }
        functions.logger.error("An error occurred!", { message: message });
        res.status(401).send({ success: false, error: message });
    }
});
exports.onNodeExpired = functions.https.onRequest(async (req, res) => {
    var _a;
    const nodeUuid = req.body.uuid;
    const nodeType = req.body.type;
    const projectId = (_a = admin.instanceId().app.options.projectId) !== null && _a !== void 0 ? _a : 'unknown';
    const huchaToken = process.env.HUCHA_TOKEN;
    const huchaHost = process.env.HUCHA_HOST;
    const backendUrl = `${huchaHost}/expire-node/${huchaToken}`;
    const payload = { 'uuid': nodeUuid, 'type': nodeType };
    const firestore = new Firestore({ projectId: projectId });
    try {
        if (nodeType == 'call') {
            /** Delete live call and related bids **/
            const callReference = firestore.collection('live_calls').doc(nodeUuid);
            await firestore.collection('live_bids')
                .where('call_id', '==', nodeUuid)
                .get()
                .then((bids) => bids.forEach((bid) => bid.ref.delete()));
            await callReference.delete();
        }
        /** Expire node in backend **/
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fetch = require('node-fetch');
        functions.logger.info(`Calling backend to expire node ${payload.uuid}`);
        // @ts-ignore
        fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
            .then((res) => res.text())
            .then((text) => functions.logger.info(`Node ${nodeUuid} of type ${nodeType} expired successfully. Message: ${text}`))
            .catch((err) => functions.logger.error(err));
    }
    catch (e) {
        // @ts-ignore
        const message = e.toString();
        functions.logger.error("Expiring node failed: ", { message: message });
        res.status(401).send({ success: false, error: message });
    }
});
exports.onOrderCreated = functions.https.onRequest(async (req, res) => {
    var _a;
    const fireNodeExpirationFunc = (_a = process.env.FIRE_NODE_EXPIRATION_FUNC) !== null && _a !== void 0 ? _a : '';
    const orderId = req.body.orderUuid;
    /** Create GC task **/
    try {
        const payload = Buffer.from(JSON.stringify({ 'uuid': orderId, 'type': 'order' })).toString('base64');
        const taskName = await (new gc_tasks_service_1.GcTasksService()).createGcTask(payload, fireNodeExpirationFunc, req.body.orderExpirationTime);
        functions.logger.info(`Task ${taskName} created successfully for order: ${orderId}`);
        res.status(201).send({ success: true, message: 'Order task created successfully' });
    }
    catch (e) {
        functions.logger.error('Creating task failed: ', e);
        // @ts-ignore
        res.status(404).send({ success: false, message: `Creating order task failed: ${e.toString()}` });
    }
});
exports.onCallCreated = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e;
    const projectId = (_a = admin.instanceId().app.options.projectId) !== null && _a !== void 0 ? _a : 'unknown';
    const fireNodeExpirationFunc = (_b = process.env.FIRE_NODE_EXPIRATION_FUNC) !== null && _b !== void 0 ? _b : '';
    const call = req.body;
    try {
        const firestore = new Firestore({ projectId: projectId });
        const order = call.order;
        await firestore.collection('live_calls').doc(call.id).set({
            delivery_address: new GeoPoint(order.deliveryAddressLat, order.deliveryAddressLng),
            delivery_address_full: order.deliveryAddress,
            pickup_address: order.hasPickupAddress ? new GeoPoint((_c = order.pickupAddressLat) !== null && _c !== void 0 ? _c : 0, (_d = order.pickupAddressLng) !== null && _d !== void 0 ? _d : 0) : null,
            pickup_address_full: (_e = order.pickupAddress) !== null && _e !== void 0 ? _e : '',
            expiration_time: Timestamp.fromMillis(call.expirationTime),
            order_id: order.id,
            order_type: order.type,
            caller_id: call.caller.id,
            caller_photo: call.caller.photo,
            caller_name: call.caller.firstname
        });
        functions.logger.info(`Live Call ${call.id} created successfully`);
        /** Create GC task **/
        try {
            const payload = Buffer.from(JSON.stringify({ 'uuid': call.id, 'type': 'call' })).toString('base64');
            const taskName = await (new gc_tasks_service_1.GcTasksService()).createGcTask(payload, fireNodeExpirationFunc, call.expirationTime);
            functions.logger.info(`Task ${taskName} created successfully for call: ${call.id}`);
            res.status(201).send({ success: true, message: 'Call created successfully' });
        }
        catch (e) {
            functions.logger.error('Creating task failed: ', e);
            // @ts-ignore
            res.status(404).send({ success: false, message: `Creating call task failed: ${e.toString()}` });
        }
    }
    catch (e) {
        functions.logger.error(`Live Call ${call.id} creation failed: `, e);
        // @ts-ignore
        res.status(404).send({ success: false, message: e.toString() });
    }
});
exports.onBidCreated = functions.https.onRequest(async (req, res) => {
    var _a;
    const bid = req.body;
    try {
        const projectId = (_a = admin.instanceId().app.options.projectId) !== null && _a !== void 0 ? _a : 'unknown';
        const firestore = new Firestore({ projectId: projectId });
        await firestore.collection('live_bids').doc(bid.id).set({
            status: bid.status,
            call_id: bid.callId,
            call_amount: bid.proposedAmount,
            caller_id: bid.caller.id,
            caller_name: bid.caller.firstname,
            caller_photo: bid.caller.photo,
            bidder_id: bid.bidder.id,
            bidder_name: bid.bidder.firstname,
            bidder_photo: bid.bidder.photo,
            call_can_bargain: bid.callCanBargain,
            bargain_amount: bid.bargainAmount,
            bargain_reply_amount: bid.bargainReplyAmount,
            created_at: Timestamp.now()
        });
        functions.logger.info(`Bid ${bid.id} created successfully`);
        functions.logger.info('### Fetching device id for customer {}', bid.caller.id);
        const messagingService = new gc_messaging_service_1.GcMessagingService();
        const data = new Map([
            ['call_id', bid.callId]
        ]);
        await messagingService.sendNotification(bid.caller.id, 'newBid', {
            title: 'A new bid placed',
            body: `A new bid of ${bid.bargainAmount} Euro has been placed now.`
        }, data);
        res.status(201).send({ success: true, message: 'Bid created successfully' });
    }
    catch (e) {
        functions.logger.error(`Bid ${bid.id} creation failed`, e);
        // @ts-ignore
        res.status(404).send({ success: false, message: e.toString() });
    }
});
exports.onBargainPlaced = functions.https.onRequest(async (req, res) => {
    var _a;
    const projectId = (_a = admin.instanceId().app.options.projectId) !== null && _a !== void 0 ? _a : 'unknown';
    const bidId = req.body.id;
    const isExecutorBargain = req.body.isExecutorBargain;
    let bargainData;
    if (isExecutorBargain) {
        bargainData = { bargain_amount: req.body.bargain_amount };
    }
    else {
        bargainData = { bargain_reply_amount: req.body.bargainReplyAmount };
    }
    try {
        const firestore = new Firestore({ projectId: projectId });
        await firestore.collection('live_bids').doc(bidId).set(bargainData, { merge: true });
        if (isExecutorBargain) {
            // @ts-ignore
            functions.logger.info(`Bargain of ${bargainData.bargain_amount} Euro placed on bid ${bidId}`);
        }
        else {
            // @ts-ignore
            functions.logger.info(`Bargain of ${bargainData.bargain_reply_amount} Euro placed on Bid ${bid.id}`);
        }
        res.status(201).send({ success: true, message: 'Bargain placed successfully' });
    }
    catch (e) {
        functions.logger.error(`Bargain placement on Bid ${bidId} failed`);
        // @ts-ignore
        res.status(401).send({ success: false, message: e.toString() });
    }
});
exports.onBidUpdated = functions.https.onRequest(async (req, res) => {
    var _a;
    const projectId = (_a = admin.instanceId().app.options.projectId) !== null && _a !== void 0 ? _a : 'unknown';
    const bidId = req.body.id;
    const bidStatus = req.body.status;
    const firestore = new Firestore({ projectId: projectId });
    const bidDocRef = firestore.collection('live_bids').doc(bidId);
    const bid = await bidDocRef.get();
    const bidData = bid.data();
    if (bidData !== undefined) {
        const bidModel = models_1.Models.toBid(bid.id, bidData);
        const messagingService = new gc_messaging_service_1.GcMessagingService();
        if (bidStatus == 'rejected') {
            await messagingService.sendNotification(bidModel.bidder.id, 'bidRejected', {
                title: 'Your bid has been rejected',
                body: `Your bid of ${bidModel.bargainAmount} has been rejected.`
            }, new Map())
                .then(() => bidDocRef.delete())
                .catch((e) => res.status(401).send({ success: false, message: e.toString() }));
        }
        if (bidStatus == 'accepted') {
            bidDocRef
                .update({ 'status': bidStatus })
                .then(() => messagingService.sendNotification(bidModel.bidder.id, 'bidAccepted', {
                title: 'Your bid has been accepted',
                body: `Your bid of ${bidModel.bargainAmount} has been accepted.`
            }, new Map()).catch((e) => res.status(401).send({ success: false, message: e.toString() })));
        }
        if (bidStatus == 'confirmed') {
            bidDocRef
                .update({ 'status': bidStatus })
                .then(() => messagingService.sendNotification(bidModel.caller.id, 'bidConfirmed', {
                title: 'Order delivery confirmed',
                body: `Your order delivery has been confirmed by the serviceman.`
            }, new Map([
                ['call_id', bidModel.callId]
            ])).catch((e) => res.status(401).send({ success: false, message: e.toString() })));
        }
        if (bidStatus == 'renounced') {
            await messagingService.sendNotification(bidModel.caller.id, 'bidRenounced', {
                title: 'Order delivery renounced',
                body: `Sorry, your order delivery has been renounced.`
            }, new Map([
                ['call_id', bidModel.callId]
            ]))
                .then(() => bidDocRef.delete())
                .catch((e) => res.status(401).send({ success: false, message: e.toString() }));
        }
        res.status(200).send({ success: true, message: 'Bargain updated successfully' });
    }
});
//# sourceMappingURL=index.js.map