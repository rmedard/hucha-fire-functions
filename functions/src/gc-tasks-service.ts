import {CloudTasksClient} from "@google-cloud/tasks";
import * as admin from 'firebase-admin';
import {firestore} from 'firebase-admin';
import {google} from "@google-cloud/tasks/build/protos/protos";
import Task = google.cloud.tasks.v2.Task;
import HttpRequest = google.cloud.tasks.v2.HttpRequest;
import Timestamp = firestore.Timestamp;
import HttpMethod = google.cloud.tasks.v2.HttpMethod;
import CreateTaskRequest = google.cloud.tasks.v2.CreateTaskRequest;
import ITask = google.cloud.tasks.v2.ITask;
import View = google.cloud.tasks.v2.Task.View;

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
     * @param {string} taskName The assigned name of the task
     */
    async createTask(payload: string, targetUrl: string, triggerTimeInMillis: number, taskName: string): Promise<string> {
        const request: HttpRequest = {
            httpMethod: HttpMethod.POST,
            headers: {'Content-Type': 'application/json'} as { [k: string]: string },
            body: payload,
            url: targetUrl
        } as HttpRequest;

        const taskProperties: CreateTaskRequest = {
            parent: this.queuePath,
            task: Task.create({
                httpRequest: HttpRequest.create(request),
                scheduleTime: Timestamp.fromMillis(triggerTimeInMillis),
                view: View.FULL,
                name: taskName
            } as ITask),
            responseView: View.FULL,
            toJSON: function(): { [k: string]: any; } {
                throw new Error("Function not implemented.");
            }
        };
        const taskRequest: CreateTaskRequest = CreateTaskRequest.create(taskProperties);
        const createdTaskData = await this.tasksClient.createTask(taskRequest);
        const createdTask = createdTaskData[0] as Task;
        return createdTask.name;
    }
}
