import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';
import {google} from "@google-cloud/tasks/build/protos/protos";
import Task = google.cloud.tasks.v2.Task;
import Timestamp = firestore.Timestamp;
import ITask = google.cloud.tasks.v2.ITask;
import View = google.cloud.tasks.v2.Task.View;
import HttpMethod = google.cloud.tasks.v2.HttpMethod;
import IHttpRequest = google.cloud.tasks.v2.IHttpRequest;
import ICreateTaskRequest = google.cloud.tasks.v2.ICreateTaskRequest;
import {CloudTasksClient} from '@google-cloud/tasks/build/cjs/src/v2';

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
                    httpMethod: HttpMethod.POST,
                    headers: {'Content-Type': 'application/json'} as { [k: string]: string },
                    body: payload,
                    url: targetUrl
                } as IHttpRequest,
                scheduleTime: Timestamp.fromMillis(triggerTimeInMillis),
                view: View.FULL
            } as ITask,
            responseView: View.FULL,
            toJSON: function(): { [k: string]: any; } {
                throw new Error("Function not implemented.");
            }
        } as ICreateTaskRequest);
        const createdTask = createdTaskData[0] as Task;
        return createdTask.name;
    }
}
