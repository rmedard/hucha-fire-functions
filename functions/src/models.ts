import {firestore} from "firebase-admin";
import DocumentData = firestore.DocumentData;
import GeoPoint = firestore.GeoPoint;
import {GeohashRange} from "geofire-common";

/**
 *
 */
export class Models {

    /**
     *
     * @param {string} id bid document id
     * @param {DocumentData} data document data
     * @return {Bid} mapped bid
     */
    static toBid(id: string, data: DocumentData): Bid {
        return {
            id: id,
            callId: data.call_id,
            caller: {
                id: data.caller_id,
                lastname: data.caller_name,
                photo: data.caller_photo
            } as UserDetails,
            bidder: {
                id: data.bidder_id,
                lastname: data.bidder_name,
                photo: data.bidder_photo
            } as UserDetails,
            bargainAmount: data.bargain_amount as number,
            proposedAmount: data.proposed_amount as number,
            bargainReplyAmount: data.bargain_reply_amount as number,
            callCanBargain: data.call_can_bargain as boolean,
            status: data.status
        } as Bid;
    }

    /**
     *
     * @param {string} id Document ID => Customer ID
     * @param {string} data
     * @return {CustomerDevice} customer device data
     */
    static toCustomerDevice(id: string, data: DocumentData): CustomerDevice {
        return {
            customerId: id,
            deviceId: data.device_id
        } as CustomerDevice;
    }

    /**
     *
     * @param {string} id Call id
     * @param {any} data call data
     * @return {Call} mapped call
     */
    static toCall(id: string, data: DocumentData): Call {
        const hasPickAddress: boolean = data.pickup_address !== null;
        const order = {
            id: data.order_id,
            type: data.order_type,
            deliveryAddressLat: (data.delivery_address as GeoPoint).latitude,
            deliveryAddressLng: (data.delivery_address as GeoPoint).longitude,
            deliveryAddress: data.delivery_address_full,
            hasPickupAddress: hasPickAddress
        } as Order;

        if (hasPickAddress) {
            order.pickupAddress = data.pickup_address_full;
            order.pickupAddressGeoHash = data.pickup_address_geo_hash;
            order.pickupAddressLat = (data.pickup_address as GeoPoint).latitude;
            order.pickupAddressLng = (data.pickup_address as GeoPoint).longitude;
        }

        return {
            id: id,
            order: order,
            caller: {
                id: data.caller_id,
                photo: data.caller_photo,
                lastname: data.caller_name
            } as UserDetails,
            expirationTime: data.expiration_time as number
        } as Call;
    }
}

export interface ResponseBody {
    success: boolean,
    message: string,
    data?: any
}

export interface Call {
    id: string,
    expirationTime: number
    order: Order,
    caller: UserDetails
}

export interface Order {
    id: string,
    type: string,
    deliveryAddressLat: number,
    deliveryAddressLng: number,
    deliveryAddressGeoHash: string,
    deliveryAddress: string,
    hasPickupAddress: boolean,
    pickupAddressLat?: number,
    pickupAddressLng?: number,
    pickupAddressGeoHash?: string,
    pickupAddress?: string,
}

export interface UserDetails {
    id: string,
    photo: string,
    lastname: string
}

export interface Bid {
    id: string,
    status: string,
    callId: string,
    caller: UserDetails,
    bidder: UserDetails,
    callCanBargain: boolean,
    proposedAmount: number,
    bargainAmount: number,
    bargainReplyAmount: number
}

export interface CustomerDevice {
    customerId: string,
    deviceId: string
}

export interface CallsSearchCriteria {
    loggedInCustomer: string,
    centerPoint: GeoPoint,
    radius: number
}

export interface GeohashCallsSearchRequest {
    deliveryAddressGeoRequest: GeohashRequest,
    pickupAddressGeoRequest?: GeohashRequest
}

export interface GeohashCallsSearchResponse {
    deliveryAddressGeoResponse: GeohashResponse,
    pickupAddressGeoResponse?: GeohashResponse
}

export interface GeohashRequest {
    geoPoint: GeoPoint,
    radius: number
}

export interface GeohashResponse {
    geohashRanges: GeohashRange[]
}
