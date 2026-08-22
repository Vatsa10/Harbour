import { defineObject, FieldType } from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

enum TicketStatus {
  NEW = 'NEW',
  TRIAGED = 'TRIAGED',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_ON_CUSTOMER = 'WAITING_ON_CUSTOMER',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

enum TicketChannel {
  EMAIL = 'EMAIL',
  CHAT = 'CHAT',
  PHONE = 'PHONE',
  WEB_FORM = 'WEB_FORM',
}

export default defineObject({
  universalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'supportTicket',
  namePlural: 'supportTickets',
  labelSingular: 'Support ticket',
  labelPlural: 'Support tickets',
  description: 'A customer support request tracked through resolution.',
  icon: 'IconTicket',
  labelIdentifierFieldMetadataUniversalIdentifier:
    TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'subject',
      label: 'Subject',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'description',
      label: 'Description',
      icon: 'IconFileDescription',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'status',
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: `'${TicketStatus.NEW}'`,
      options: [
        { value: TicketStatus.NEW, label: 'New', position: 0, color: 'blue' },
        {
          value: TicketStatus.TRIAGED,
          label: 'Triaged',
          position: 1,
          color: 'purple',
        },
        {
          value: TicketStatus.IN_PROGRESS,
          label: 'In progress',
          position: 2,
          color: 'yellow',
        },
        {
          value: TicketStatus.WAITING_ON_CUSTOMER,
          label: 'Waiting on customer',
          position: 3,
          color: 'orange',
        },
        {
          value: TicketStatus.RESOLVED,
          label: 'Resolved',
          position: 4,
          color: 'green',
        },
        {
          value: TicketStatus.CLOSED,
          label: 'Closed',
          position: 5,
          color: 'gray',
        },
      ],
    },
    {
      universalIdentifier: TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'priority',
      label: 'Priority',
      icon: 'IconFlag',
      defaultValue: `'${TicketPriority.MEDIUM}'`,
      options: [
        { value: TicketPriority.LOW, label: 'Low', position: 0, color: 'gray' },
        {
          value: TicketPriority.MEDIUM,
          label: 'Medium',
          position: 1,
          color: 'blue',
        },
        {
          value: TicketPriority.HIGH,
          label: 'High',
          position: 2,
          color: 'orange',
        },
        {
          value: TicketPriority.URGENT,
          label: 'Urgent',
          position: 3,
          color: 'red',
        },
      ],
    },
    {
      universalIdentifier: TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'channel',
      label: 'Channel',
      icon: 'IconMessage',
      defaultValue: `'${TicketChannel.EMAIL}'`,
      options: [
        {
          value: TicketChannel.EMAIL,
          label: 'Email',
          position: 0,
          color: 'blue',
        },
        {
          value: TicketChannel.CHAT,
          label: 'Chat',
          position: 1,
          color: 'green',
        },
        {
          value: TicketChannel.PHONE,
          label: 'Phone',
          position: 2,
          color: 'orange',
        },
        {
          value: TicketChannel.WEB_FORM,
          label: 'Web form',
          position: 3,
          color: 'purple',
        },
      ],
    },
    {
      universalIdentifier:
        TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'slaFirstResponseDueAt',
      label: 'SLA: first response due',
      icon: 'IconClockHour3',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier:
        TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'slaResolutionDueAt',
      label: 'SLA: resolution due',
      icon: 'IconClockHour9',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'firstRespondedAt',
      label: 'First responded at',
      icon: 'IconMessageCheck',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'resolvedAt',
      label: 'Resolved at',
      icon: 'IconCheck',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'aiTriageSummary',
      label: 'AI triage summary',
      description:
        'Written by the support triage agent. Every write to this field is a proposal awaiting human approval, same as any other AI-originated write.',
      icon: 'IconRobot',
      isNullable: true,
      defaultValue: null,
    },
  ],
});
