const functions = require("firebase-functions");

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });


exports.stripePayment = functions.https.onRequest(async (req, res) => {

    const stripe = require("stripe")(functions.config().stripe.testkey);

    try {
        let customerId;
        const customerList = await stripe.customers.list({
            email: req.body.email,
            limit: 1
        });

        if (customerList.data.length !== 0) {
            let customer = customerList.data[0];
            if (customer.name.length === 0) {
                const updateParams = new stripe.CustomerUpdateParams;
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

        const ephemeralKey = await stripe.ephemeralKeys.create(
            {customer: customerId},
            {apiVersion: '2022-08-01'}
        );

        await stripe.paymentIntents.create({
            amount: parseFloat(req.body.amount),
            currency: req.body.currency,
            customer: customerId
        }, function (err, paymentIntent) {
            if (err != null) {
                functions.logger.error("Error occurred!", {message: err.message});
            } else {
                res.json({
                    paymentIntent: paymentIntent.client_secret,
                    ephemeralKey: ephemeralKey.secret,
                    customerId: customerId,
                    success: true
                })
            }
        });

    } catch (error) {
        functions.logger.error("An error occurred!", {message: error.message});
        res.status(404).send({success: false, error: error.message});
    }
});
