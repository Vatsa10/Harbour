import {
  type RecordScopeNode,
  type RecordScopeRule,
} from 'searm-shared/types';

import { compileRecordScope } from 'src/engine/searm-orm/record-scope/compile-record-scope.util';

const ownedByMe: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-owner',
  operator: 'eq',
  value: { source: 'principal', attribute: 'workspaceMemberId' },
};

const emea: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-region',
  operator: 'eq',
  value: { source: 'literal', value: 'EMEA' },
};

const rule = (id: string, expression: RecordScopeNode): RecordScopeRule => ({
  id,
  roleId: 'role-1',
  objectMetadataId: 'object-1',
  expression,
});

describe('compileRecordScope', () => {
  it('should be unrestricted when the role has no rules', () => {
    expect(compileRecordScope({ recordScopeRules: [], principal: {} })).toEqual(
      { kind: 'unrestricted' },
    );
  });

  it('should return the single rule expression untouched', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', emea)],
        principal: {},
      }),
    ).toEqual({ kind: 'expression', node: emea });
  });

  it('should OR several rules of the same role together', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe), rule('r2', emea)],
        principal: { workspaceMemberId: 'wm-1' },
      }),
    ).toEqual({
      kind: 'expression',
      node: { type: 'group', operator: 'or', children: [ownedByMe, emea] },
    });
  });

  it('should drop a whole rule whose principal attribute is unresolvable', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe), rule('r2', emea)],
        principal: {},
      }),
    ).toEqual({ kind: 'expression', node: emea });
  });

  it('should deny all when every rule is unresolvable', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe)],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  // The reason rule-level (not node-level) falsity is the contract: a negated
  // reference to a missing principal must not become a grant.
  it('should deny rather than grant when a NOT wraps an unresolvable reference', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', { type: 'not', child: ownedByMe })],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  it('should drop a rule whose unresolvable reference is nested under an OR', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [
          rule('r1', {
            type: 'group',
            operator: 'or',
            children: [ownedByMe, emea],
          }),
        ],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });
});
