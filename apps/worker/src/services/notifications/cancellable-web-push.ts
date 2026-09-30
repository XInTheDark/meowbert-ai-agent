import { type ClientRequest } from "node:http";
import { request } from "node:https";
import webpush, { type PushSubscription, type RequestDetails } from "web-push";

interface PushRequestError extends Error {
  statusCode?: number;
}

interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export function sendCancellableWebPushRequest(
  subscription: PushSubscription,
  payload: string,
  vapidDetails: VapidDetails,
  timeoutMs: number
): Promise<void> {
  let requestDetails: RequestDetails;
  try {
    requestDetails = webpush.generateRequestDetails(subscription, payload, { vapidDetails });
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pushRequest: ClientRequest | null = null;

    const rejectRequest = (error: unknown): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      reject(error);
    };

    const resolveRequest = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve();
    };

    try {
      const endpoint = new URL(requestDetails.endpoint);
      pushRequest = request({
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: requestDetails.method,
        headers: requestDetails.headers
      }, (response) => {
        let responseText = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseText += chunk;
        });
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode > 299) {
            const error = new Error(`Received unexpected response code: ${response.statusCode ?? "unknown"}`) as PushRequestError;
            error.statusCode = response.statusCode;
            rejectRequest(error);
            return;
          }

          resolveRequest();
        });
        response.on("error", rejectRequest);
      });

      timer = setTimeout(() => {
        pushRequest?.destroy(new Error(`Web Push request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pushRequest.on("error", rejectRequest);
      if (requestDetails.body) {
        pushRequest.write(requestDetails.body);
      }
      pushRequest.end();
    } catch (error) {
      rejectRequest(error);
    }
  });
}
