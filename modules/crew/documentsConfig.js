export const DOCUMENT_CATEGORIES = [
  { key: 'LICENCE', label: 'Licence' },
  { key: 'MEDICAL', label: 'Medical' },
  { key: 'RATINGS', label: 'Ratings & Endorsements' },
  { key: 'CHECKS', label: 'Checks & Proficiencies' },
  { key: 'TRAINING', label: 'Training' },
  { key: 'IDENTITY', label: 'Security & Identity' },
  { key: 'GENERAL', label: 'General / Operator' },
  { key: 'CUSTOM', label: 'Other (Custom)' }
];

export const DOCUMENT_MASTER_LIST = {
  LICENCE: [
    { name: 'Student Pilot Licence (SPL)', authority: 'DGCA', reminderDays: 30 },
    { name: 'Private Pilot Licence (PPL)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Commercial Pilot Licence (CPL)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Airline Transport Pilot Licence (ATPL)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Flight Radio Telephony Operator Licence (FRTOL)', authority: 'WPC / DGCA', reminderDays: 45 },
    { name: 'Restricted Radio Telephony (RTR)', authority: 'WPC', reminderDays: 45 },
    { name: 'English Language Proficiency (ELP)', authority: 'DGCA', reminderDays: 45 }
  ],
  MEDICAL: [
    { name: 'Class 1 Medical', authority: 'DGCA Medical Cell', reminderDays: 30 },
    { name: 'Class 2 Medical', authority: 'Approved Medical Examiner', reminderDays: 30 },
    { name: 'Medical Fitness Declaration', authority: 'Operator Medical Department', reminderDays: 30 }
  ],
  RATINGS: [
    { name: 'Instrument Rating (IR)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Multi-Engine Rating (ME)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Single-Engine Rating (SE)', authority: 'DGCA', reminderDays: 60 },
    { name: 'First Officer Rating (FIR)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Flight Instructor Rating (AFI)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Multi-Engine Instructor Rating (MEI)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Type Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'PBN Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'RVSM Endorsement', authority: 'DGCA', reminderDays: 60 },
    { name: 'Low Visibility Operations (LVO)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Night Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'Seaplane Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'Glider Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'Helicopter Type Rating', authority: 'DGCA', reminderDays: 60 },
    { name: 'Examiner / Check Pilot Authorization', authority: 'DGCA', reminderDays: 60 }
  ],
  CHECKS: [
    { name: 'Pilot Proficiency Check (PPC)', authority: 'Approved Examiner', reminderDays: 30 },
    { name: 'Operator Proficiency Check (OPC)', authority: 'Operator Training Department', reminderDays: 30 },
    { name: 'Instrument Rating Check', authority: 'Approved Examiner', reminderDays: 30 },
    { name: 'Route / Line Check', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Annual Route / Line Check', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Base Check', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Skill Test', authority: 'DGCA Examiner', reminderDays: 30 },
    { name: 'Dangerous Goods (DG) CAT-10 Check', authority: 'Training Department', reminderDays: 45 }
  ],
  TRAINING: [
    { name: 'Crew Resource Management (CRM) Initial', authority: 'Training Department', reminderDays: 30 },
    { name: 'Crew Resource Management (CRM) Recurrent', authority: 'Training Department', reminderDays: 30 },
    { name: 'Dangerous Goods (DG) Awareness', authority: 'Training Department', reminderDays: 45 },
    { name: 'Dangerous Goods (DG) CAT-10 Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'Security / AVSEC Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'Human Factors Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'SMS / Safety Management Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'SOP Training', authority: 'Operator Training Department', reminderDays: 30 },
    { name: 'Company Induction', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'Aircraft Technical Type Course', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'Emergency & Survival Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'Ditching Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'Fire Fighting Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'First Aid Training', authority: 'Training Department', reminderDays: 45 },
    { name: 'FRMS / Fatigue Risk Management', authority: 'Training Department', reminderDays: 45 },
    { name: 'TEM / Threat & Error Management', authority: 'Training Department', reminderDays: 45 },
    { name: 'Monsoon Ops Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'Winter Ops Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'LVO Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'UPRT Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'GRF / Runway Condition Reporting', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'Navigation Procedures Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'TCAS Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'EGPWS / TAWS Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'GPWS Training', authority: 'Operator Training Department', reminderDays: 45 },
    { name: 'Route Qualification', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Aerodrome Qualification', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Special Airport Qualification', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Simulator Training Record', authority: 'Operator Training Department', reminderDays: 30 },
    { name: 'Line Training Completion', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'Supervised Line Flying (SLF)', authority: 'Flight Operations', reminderDays: 30 },
    { name: 'EFB Training', authority: 'Operator Training Department', reminderDays: 45 }
  ],
  IDENTITY: [
    { name: 'Airport Entry Permit (AEP)', authority: 'DGCA', reminderDays: 60 },
    { name: 'Company ID Card', authority: 'Operator HR', reminderDays: 120 },
    { name: 'Passport', authority: 'Passport Authority', reminderDays: 120 },
    { name: 'Visa', authority: 'Immigration Authority', reminderDays: 90 },
    { name: 'Aadhaar Card', authority: 'UIDAI', reminderDays: 180 },
    { name: 'PAN Card', authority: 'Income Tax Department', reminderDays: 180 }
  ],
  GENERAL: [
    { name: 'Pilot Logbook', authority: 'Pilot', reminderDays: 180 },
    { name: 'Flying Experience Certificate', authority: 'DGCA', reminderDays: 60 },
    { name: 'No Objection Certificate (NOC)', authority: 'DGCA', reminderDays: 90 },
    { name: 'Insurance Documents', authority: 'Operator / Insurer', reminderDays: 90 },
    { name: 'DGCA Approval Letters', authority: 'DGCA', reminderDays: 90 },
    { name: 'Operator Documents', authority: 'Operator', reminderDays: 60 }
  ],
  CUSTOM: []
};
