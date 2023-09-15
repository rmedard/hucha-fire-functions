import {firestore} from "firebase-admin";
import DocumentData = firestore.DocumentData;

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
                firstname: data.caller_name,
                photo: data.caller_photo
            } as UserDetails,
            bidder: {
                id: data.bidder_id,
                firstname: data.bidder_name,
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
    deliveryAddress: string,
    hasPickupAddress: boolean,
    pickupAddressLat?: number,
    pickupAddressLng?: number,
    pickupAddress?: string,
}

export interface UserDetails {
    id: string,
    photo: string,
    firstname: string
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
