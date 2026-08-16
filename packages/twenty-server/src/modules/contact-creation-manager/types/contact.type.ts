export type Contact = {
  handle: string;
  displayName: string;
  // The ingested message this contact was seen on, when there is one. It is
  // the evidence the reciprocity gate needs (message -> thread -> did we ever
  // send into that thread). Absent on the calendar path.
  messageId?: string | null;
};
