export const PAGE_SIZE = 10;

export const CREW_PROFILE_SESSION_KEY = 'vs-selected-crew-profile';

export const CREW_TAB_STORAGE_KEY = 'vs-crew-active-tab';

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
  activeTab: 'directory',
  profileEditUid: null,
  selectedRows: new Set(),
  currentPage: 1,
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
  compliance: 'ALL',
  role: 'ALL',
  status: 'ALL',
  sortField: 'name',
  sortDirection: 'asc'
};

export const docListState = {
  searchText: '',
  category: 'ALL',
  status: 'ALL'
};
