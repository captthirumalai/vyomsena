const CONTRACTS = {
  users: {
    required: ['uid', 'name', 'email', 'role', 'linkedOperator', 'createdAt']
  },
  user_documents: {
    required: [
      'userId',
      'userName',
      'documentCategory',
      'documentName',
      'issueDate',
      'expiryDate',
      'issuingAuthorityOrBody',
      'licenseOrCertificateNumber',
      'operatorId',
      'readers',
      'lastEditedBy',
      'lastModified',
      'reminderLeadTimeDays'
    ]
  },
  connection_requests: {
    required: ['requesterId', 'recipientId', 'requesterName', 'requesterEmail', 'recipientEmail', 'status', 'createdAt']
  },
  access_codes: {
    required: ['code', 'expiresAt', 'pilotId']
  },
  training_centers: {
    required: []
  },
  training_offerings: {
    required: []
  },
  training_bookings: {
    required: []
  },
  operator_training_records: {
    required: ['operatorId', 'userId', 'trainingType', 'status', 'createdAt', 'lastModified']
  },
  crew_profiles: {
    required: ['operatorId', 'name', 'role', 'status', 'createdAt', 'lastModified']
  },
  crew_link_codes: {
    required: ['crewProfileId', 'operatorId', 'code', 'expiresAt', 'used', 'status', 'createdAt', 'lastModified']
  }
};

function warn(contractName, stage, source, message, details) {
  console.warn(`[schema-contract][${contractName}][${stage}] ${source}: ${message}`, details || '');
}

function getMissingFields(required, data) {
  return required.filter((field) => !(field in data));
}

export function validateContract(contractName, data, source, stage = 'read') {
  const contract = CONTRACTS[contractName];
  if (!contract || !data || typeof data !== 'object') return true;

  const missing = getMissingFields(contract.required, data);
  if (missing.length > 0) {
    warn(contractName, stage, source, `missing required fields: ${missing.join(', ')}`, data);
    return false;
  }

  return true;
}

export function validateReadersField(data, source, stage = 'read') {
  if (!data || !('readers' in data)) return true;
  if (!Array.isArray(data.readers)) {
    warn('user_documents', stage, source, 'readers should be an array', data.readers);
    return false;
  }
  return true;
}
