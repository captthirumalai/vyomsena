export class Pilot {
  constructor({ uid, name, email, role, linkedOperator, createdAt }) {
    this.uid = uid;
    this.name = name;
    this.email = email;
    this.role = role;
    this.linkedOperator = linkedOperator;
    this.createdAt = createdAt;
  }
}
