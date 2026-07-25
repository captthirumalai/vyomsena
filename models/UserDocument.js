export class UserDocument {
  constructor({ firestoreId, userId, userName, documentName, documentCategory, licenseOrCertificateNumber, issueDate, expiryDate, reminderLeadTimeDays, operatorId, readers }) {
    this.firestoreId = firestoreId;
    this.userId = userId;
    this.userName = userName;
    this.documentName = documentName;
    this.documentCategory = documentCategory;
    this.licenseOrCertificateNumber = licenseOrCertificateNumber;
    this.issueDate = issueDate;
    this.expiryDate = expiryDate;
    this.reminderLeadTimeDays = reminderLeadTimeDays;
    this.operatorId = operatorId;
    this.readers = readers;
  }
}
