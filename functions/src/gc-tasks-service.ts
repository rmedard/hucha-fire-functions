import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';
import Timestamp = firestore.Timestamp;
import {CloudTasksClient} from '@google-cloud/tasks';

/**
 * Google Cloud Tasks Service
 */
export class GcTasksService {

    private tasksClient;
    private readonly queuePath;

    /**
     * Initialise Service
     */
    constructor() {
        this.tasksClient = new CloudTasksClient();
        const projectId = admin.instanceId().app.options.projectId ?? '';
        this.queuePath = this.tasksClient.queuePath(projectId, 'europe-west1', 'expire-node-tasks');
    }

    /**
     *
     * @param {string} payload Task payload to be sent
     * @param {string} targetUrl URL to be called when task executes
     * @param {number} triggerTimeInMillis When task triggers
     */
    async createGcTask(payload: string, targetUrl: string, triggerTimeInMillis: number): Promise<string> {
        const createdTaskData = await this.tasksClient.createTask({
            parent: this.queuePath,
            task: {
                httpRequest: {
                    httpMethod: 1,
                    headers: {'Content-Type': 'application/json'} as { [k: string]: string },
                    body: payload,
                    url: targetUrl
                },
                scheduleTime: Timestamp.fromMillis(triggerTimeInMillis),
                view: 2
            },
            responseView: 2
        });
        const createdTask = createdTaskData[0];
        return createdTask.name as string;
    }
}
