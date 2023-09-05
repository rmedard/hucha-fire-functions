import {messaging} from "firebase-admin";
import Notification = messaging.Notification;
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {AndroidConfig, AndroidNotification, TokenMessage} from "firebase-admin/lib/messaging";

/**
 * Google Cloud Messaging Service
 */
export class GcMessagingService {

    /**
     *
     * @param {string} deviceId FCM Token used as device identifier
     * @param {string} notificationType Notification Type
     * @param {Notification} notification The actual notification object
     * @param {Map<string, string>} data Data to be sent back
     */
    async sendNotification(deviceId: string, notificationType: string, notification: Notification, data: Map<string, string>): Promise<void> {
        const dataSet = data.set('notification-type', notificationType);
        const messageId = await admin.messaging().send(
            {
                notification: notification,
                android: {
                    notification: {
                        title: notification.title,
                        body: notification.body
                    } as AndroidNotification
                } as AndroidConfig,
                data: Object.fromEntries(dataSet.entries()),
                token: deviceId
            } as TokenMessage);
        functions.logger.info(`Notification: ${messageId} sent to FCM`);
    }
}
