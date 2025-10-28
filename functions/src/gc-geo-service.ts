import {Call, CallsSearchCriteria, Models} from './models';
import {geohashQueryBounds, GeohashRange} from 'geofire-common';
import {firestore} from 'firebase-admin';
import * as admin from 'firebase-admin';
import Firestore = firestore.Firestore;

/**
 * Google Cloud Geo-location Service
 */
export class GcGeoService {

    /**
     *
     * @param {CallsSearchCriteria} searchCriteria calls search criteria object
     */
    async fetchCallsDeliverableInArea(searchCriteria: CallsSearchCriteria): Promise<Call[]> {
        const projectId = admin.instanceId().app.options.projectId ?? 'unknown';
        const firestore = new Firestore({projectId: projectId});
        const lat = searchCriteria.centerPoint.latitude;
        const long = searchCriteria.centerPoint.longitude;
        const radiusInM = searchCriteria.radius * 1000;
        const geos: GeohashRange[] = geohashQueryBounds([lat, long], radiusInM);
        const calls: Call[] = [];
        for (const g of geos) {
            const snapshot = await firestore
                .collection('live_calls')
                .where('caller_id', '!=', searchCriteria.loggedInCustomer)
                .where('delivery_address_geo_hash', '>=', g[0])
                .where('delivery_address_geo_hash', '<=', g[1])
                .get();
            snapshot.forEach((doc) => {
                calls.push(Models.toCall(doc.id, doc.data()));
            });
        }
        return calls;
    }
}
