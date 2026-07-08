export type FulfillmentListRow = {
  id: string;
  stockCenterId: string;
  stockCenterName: string;
  teamId: string;
  teamName: string;
  projectId: string;
  projectCode: string;
  requestDate: string;
  requestedByName: string | null;
  status: string;
  resultado: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  claimExpiresAt: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentDetailItem = {
  id: string;
  materialId: string;
  materialCode: string;
  description: string;
  umb: string;
  tipo: string;
  serialTrackingType: string;
  quantityRequested: number;
  quantityFulfilled: number | null;
  itemStatus: string;
  unfulfilledReasonCode: string | null;
  serialNumber: string | null;
  lotCode: string | null;
  notes: string | null;
  currentBalance: number;
  resultingTransferItemId: string | null;
  isReversed: boolean;
};

export type FulfillmentDetail = {
  request: {
    id: string;
    stockCenterId: string;
    stockCenterName: string;
    teamId: string;
    teamName: string;
    projectId: string;
    projectCode: string;
    requestDate: string;
    requestedByName: string | null;
    status: string;
    resultado: string | null;
    claimedBy: string | null;
    claimedByName: string | null;
    claimExpiresAt: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: FulfillmentDetailItem[];
};

export type AdjustmentReason = { code: string; label: string; requiresNotes: boolean };

export type DecisionType = "ACCEPT" | "REDUCE" | "REJECT";

export type ItemDecision = {
  decision: DecisionType | null;
  quantity: string;
  reasonCode: string;
  serialNumber: string;
  lotCode: string;
  notes: string;
};

export type SerialOption = {
  id: string;
  serialNumber: string;
  lotCode: string;
};
