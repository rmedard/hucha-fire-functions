import {CloudTasksClient} from "@google-cloud/tasks";
import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';
import {google} from "@google-cloud/tasks/build/protos/protos";
import Task = google.cloud.tasks.v2.Task;
import HttpRequest = google.cloud.tasks.v2.HttpRequest;
import Timestamp = firestore.Timestamp;
import HttpMethod = google.cloud.tasks.v2.HttpMethod;
import CreateTaskRequest = google.cloud.tasks.v2.CreateTaskRequest;

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
    async createTask(payload: string, targetUrl: string, triggerTimeInMillis: number): Promise<string> {
        const createdTaskData = await this.tasksClient.createTask(CreateTaskRequest.create({
            parent: this.queuePath,
            task: Task.create({
                httpRequest: HttpRequest.create({
                    httpMethod: HttpMethod.POST,
                    body: payload,
                    url: targetUrl
                }),
                scheduleTime: Timestamp.fromMillis(triggerTimeInMillis)
            })
        }));
        const createdTask = createdTaskData[0] as Task;
        return createdTask.name;
    }
}
