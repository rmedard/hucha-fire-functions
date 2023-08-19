import {messaging} from "firebase-admin";
import Notification = messaging.Notification;
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import TokenMessage = messaging.TokenMessage;

/**
 * Google Cloud Messaging Service
 */
export class GcMessagingService {

    /**
     *
     * @param {string} deviceId FCM Token used as device identifier
     * @param {Notification} notification The actual notification object
     */
    async sendNotification(deviceId: string, notification: Notification): Promise<void> {
        const messageId = await admin.messaging().send(
            {
                notification: notification,
                token: deviceId
            } as TokenMessage);
        functions.logger.info(`Notification: ${messageId} sent to FCM`);
    }
}
