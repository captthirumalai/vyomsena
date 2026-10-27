export const PAGE_SIZE = 10;

export const CREW_LIST_VIEW_KEY = 'vs-crew-list-view';

export const crewState = {
  activeView: null,
  activeOperatorUid: null,
  activeCurrentUser: null,
  activeRole: 'OPERATIONS',
  pilotsCache: [],
  docsByPilotCache: new Map(),
  selectedPilotUid: null,
  queueMonitorTimer: null,
  queueSyncBusy: false,
  queueSyncLastAttemptAt: null,
  queueSyncLastError: null,
  queueSyncFlashTimer: null,
  crewPermissions: null,
  profileEditUid: null,
  selectedRows: new Set(),
  currentPage: 1,
  drawerView: 'overview',
  activeDocument: null,
  crewUnsubscribe: null,
  pilotDocUnsubscribe: null,
  requiredDocumentPolicy: null
};

export const crewListState = {
  searchText: '',
  view: 'cards',
  statuses: new Set(),
  compliances: new Set(),
  roles: new Set(),
  bases: new Set(),
  sortField: 'name',
  sortDirection: 'asc',
  filterOpen: false
};

export const docListState = {
  searchText: '',
  category: 'ALL',
  status: 'ALL'
};
