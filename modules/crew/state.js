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
  outgoingRequestsCache: [],
  incomingRequestsCache: [],
  queueMonitorTimer: null,
  linkCodeTimer: null,
  queueSyncBusy: false,
  queueSyncLastAttemptAt: null,
  queueSyncLastError: null,
  queueSyncFlashTimer: null,
  crewPermissions: null,
  profileEditUid: null,
  selectedRows: new Set(),
  currentPage: 1,
  drawerView: 'overview',
  drawerInviteOpen: false,
  activeDocument: null,
  activeLinkCode: null,
  activeLinkCodeExpiresAt: null,
  activeLinkCodePilotUid: null,
  crewUnsubscribe: null,
  pilotDocUnsubscribe: null,
  outgoingRequestUnsubscribe: null,
  incomingRequestUnsubscribe: null
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
