import * as functions from "firebase-functions";
import {Request, Response} from "firebase-functions";
import Stripe from 'stripe';
import * as admin from 'firebase-admin';

import {CloudTasksClient} from '@google-cloud/tasks';
import {google} from '@google-cloud/tasks/build/protos/protos';
import Task = google.cloud.tasks.v2.Task;
import HttpRequest = google.cloud.tasks.v2.HttpRequest;
import HttpMethod = google.cloud.tasks.v2.HttpMethod;
import Timestamp = google.protobuf.Timestamp;
import CreateTaskRequest = google.cloud.tasks.v2.CreateTaskRequest;


admin.initializeApp();
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

exports.stripePayment = functions.https.onRequest(async (req: Request, res: Response) => {
    const secretKey = functions.config().stripe.testkey;
    const apiVersionDate = '2022-08-01';

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
        res.status(401).send({success: false, error: message});
    }
});

exports.onCallCreated = functions.https.onRequest(async (req: Request, res: Response) => {
    const tasksClient = new CloudTasksClient();
    const callId = req.body.call_id;
    const expirationTime = req.body.expiry as number;
    const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
    const huchaToken = process.env.HUCHA_TOKEN;
    const huchaHost = process.env.HUCHA_HOST;
    functions.logger.debug(`QueuePath Project: ${projectId}`);
    const queuePath = tasksClient.queuePath(projectId, 'us-central1', 'call-tasks');
    const url = `${huchaHost}/expire-call/${huchaToken}`;

    const task = Task.create({
        httpRequest: {
            httpMethod: HttpMethod.POST,
            body: Buffer.from(JSON.stringify({'callId': callId})).toString('base64'),
            url
        } as HttpRequest,
        scheduleTime: {
            seconds: expirationTime
        } as Timestamp
    });

    // @ts-ignore
    task.httpRequest.headers = {'Content-Type': 'application/json'};

    try {
        functions.logger.info(`Creating task for call ${callId} expiring at ${expirationTime}`);

        // @ts-ignore
        const createdTaskData = await tasksClient.createTask({parent: queuePath, task} as CreateTaskRequest);
        // @ts-ignore
        const createdTask = createdTaskData[0] as Task;
        const taskName = createdTask.name;
        res.json({
            'task_name': taskName,
            'call_id': callId
        });
        functions.logger.info(`Task ${taskName} created successfully for call ${callId}`);
    } catch (e) {
        // @ts-ignore
        const message = e.toString();
        functions.logger.error("An error occurred!", {message: message});
        res.status(401).send({success: false, error: message});
    }
});
