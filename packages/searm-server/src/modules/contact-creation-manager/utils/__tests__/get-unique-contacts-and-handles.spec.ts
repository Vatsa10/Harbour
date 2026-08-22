import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { getUniqueContactsAndHandles } from 'src/modules/contact-creation-manager/utils/get-unique-contacts-and-handles.util';

describe('getUniqueContactsAndHandles', () => {
  it('should return empty arrays when contacts is empty', () => {
    const contacts: Contact[] = [];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([]);
    expect(result.uniqueHandles).toEqual([]);
  });

  it('should return unique contacts and handles', () => {
    const contacts: Contact[] = [
      { handle: 'john@searm.com', displayName: 'John Doe' },
      { handle: 'john@searm.com', displayName: 'John Doe' },
      { handle: 'jane@searm.com', displayName: 'Jane Smith' },
      { handle: 'jane@searm.com', displayName: 'Jane Smith' },
      { handle: 'jane@searm.com', displayName: 'Jane Smith' },
    ];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([
      { handle: 'john@searm.com', displayName: 'John Doe' },
      { handle: 'jane@searm.com', displayName: 'Jane Smith' },
    ]);
    expect(result.uniqueHandles).toEqual([
      'john@searm.com',
      'jane@searm.com',
    ]);
  });

  it('should deduplicate handles when they are in different cases', () => {
    const contacts: Contact[] = [
      { handle: 'john@searm.com', displayName: 'John Doe' },
      { handle: 'John@searm.com', displayName: 'John Doe' },
    ];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([
      { handle: 'john@searm.com', displayName: 'John Doe' },
    ]);
    expect(result.uniqueHandles).toEqual(['john@searm.com']);
  });
});
