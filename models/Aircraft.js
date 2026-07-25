export class Aircraft {
  constructor({ reg, type, status, nextInspection, operatorId, createdAt, updatedAt }) {
    this.reg = reg;
    this.type = type;
    this.status = status;
    this.nextInspection = nextInspection;
    this.operatorId = operatorId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
