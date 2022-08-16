"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const stripe_1 = require("stripe");
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
exports.stripePayment = functions.https.onRequest(async (req, res) => {
    const secretKey = functions.config().stripe.testkey;
    const apiVersionDate = '2022-08-01';
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
//# sourceMappingURL=index.js.map