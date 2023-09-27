import {firestore, messaging} from "firebase-admin";
import Notification = messaging.Notification;
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {AndroidConfig, AndroidNotification, TokenMessage} from "firebase-admin/lib/messaging";
import DocumentData = firestore.DocumentData;
import Firestore = firestore.Firestore;
import Timestamp = firestore.Timestamp;

/**
 * Google Cloud Messaging Service
 */
export class GcMessagingService {

    /**
     *
     * @param {string} targetCustomerId FCM Token used as device identifier
     * @param {string} notificationType Notification Type
     * @param {Notification} notification The actual notification object
     * @param {Map<string, string>} data Data to be sent back
     */
    async sendNotification(targetCustomerId: string, notificationType: string, notification: Notification, data: Map<string, string>): Promise<void> {
        const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
        const firestore = new Firestore({projectId: projectId});
        firestore
            .collection('user_devices')
            .doc(targetCustomerId)
            .get()
            .then(async (doc) => {
                if (doc.exists) {
                    const deviceData = doc.data() as DocumentData;
                    const dataSet = data.set('notification_type', notificationType);
                    admin.messaging().send(
                        {
                            notification: notification,
                            android: {
                                notification: {
                                    title: notification.title,
                                    body: notification.body
                                } as AndroidNotification
                            } as AndroidConfig,
                            data: Object.fromEntries(dataSet.entries()),
                            token: deviceData.device_id
                        } as TokenMessage)
                        .then((messageId) => functions.logger.info(`Notification: ${messageId} sent to FCM`))
                        .catch((err) => functions.logger.error(`Sending notification to customer ${targetCustomerId} failed`, err));
                } else {
                    functions.logger.error(`Sending notification failed. Device unknown for customer ${targetCustomerId}`);
                }
            })
            .catch((err) => functions.logger.error('Fetching user device failed', err));
        await firestore
            .collection('notifications')
            .add({
                'type': notificationType,
                'title': notification.title,
                'body': notification.body,
                'target_customer': targetCustomerId,
                'created_at': Timestamp.now(),
                'metadata': Object.fromEntries(data.entries())
            });
    }
}
