export type RequisitionMetaStockCenter = { id: string; name: string };
export type RequisitionMetaTeam = { id: string; name: string; stockCenterId: string | null; hasStockCenter: boolean; foremanName: string | null };
export type RequisitionMetaProject = { id: string; projectCode: string };
export type RequisitionMetaMaterial = {
  id: string;
  materialCode: string;
  description: string;
  materialType?: string;
  serialTrackingType?: string;
};
export type RequisitionAdjustmentReason = { code: string; label: string; requiresNotes: boolean };

export type RequisitionMeta = {
  stockCenters: RequisitionMetaStockCenter[];
  teams: RequisitionMetaTeam[];
  projects: RequisitionMetaProject[];
  materials: RequisitionMetaMaterial[];
  adjustmentReasons: RequisitionAdjustmentReason[];
};

export type RequisitionFormItem = {
  materialId: string;
  materialCode: string;
  description: string;
  quantity: string;
};

export type RequisitionListRow = {
  id: string;
  stockCenterName: string;
  teamName: string;
  projectCode: string;
  requestDate: string;
  requestedByName: string | null;
  status: string;
  resultado: string | null;
  claimedByName: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RequisitionListResponse = {
  items: RequisitionListRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type RequisitionDetailItem = {
  id: string;
  materialId: string;
  materialCode: string;
  description: string;
  quantityRequested: number;
  quantityFulfilled: number | null;
  itemStatus: string;
  unfulfilledReasonCode: string | null;
  serialNumber: string | null;
  lotCode: string | null;
};

export type RequisitionDetail = {
  request: {
    id: string;
    stockCenterId: string;
    stockCenterName: string;
    teamId: string;
    teamName: string;
    projectId: string;
    projectCode: string;
    requestDate: string;
    status: string;
    resultado: string | null;
  };
  items: RequisitionDetailItem[];
};
