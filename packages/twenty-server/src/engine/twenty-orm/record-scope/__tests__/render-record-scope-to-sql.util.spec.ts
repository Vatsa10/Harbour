import { PermissionsException } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { evaluateRecordScope } from 'src/engine/twenty-orm/record-scope/evaluate-record-scope.util';
import { renderRecordScopeToSql } from 'src/engine/twenty-orm/record-scope/render-record-scope-to-sql.util';

import {
  COLUMN_NAMES_BY_FIELD_METADATA_ID as columnNamesByFieldMetadataId,
  FIELD_REGION,
  PRINCIPAL as principal,
  RECORD_SCOPE_CASES,
  andNode,
  eqEmea,
  inEmpty,
  isNullRegion,
  neqEmea,
  notInEmpty,
  ownedByMe,
} from './record-scope-cases';

const render = (node: Parameters<typeof renderRecordScopeToSql>[0]['node']) =>
  renderRecordScopeToSql({
    node,
    tableAlias: 'opportunity',
    columnNamesByFieldMetadataId,
    principal,
    parameterPrefix: 'recordScope_opportunity',
  });

describe('renderRecordScopeToSql', () => {
  it('should render eq as a bound parameter comparison', () => {
    expect(render(eqEmea)).toEqual({
      sql: '("opportunity"."region" IS NOT DISTINCT FROM :recordScope_opportunity_0)',
      parameters: { recordScope_opportunity_0: 'EMEA' },
    });
  });

  it('should render neq as IS DISTINCT FROM so a null column still matches', () => {
    expect(render(neqEmea)).toEqual({
      sql: '("opportunity"."region" IS DISTINCT FROM :recordScope_opportunity_0)',
      parameters: { recordScope_opportunity_0: 'EMEA' },
    });
  });

  it('should render an eq against a null literal as IS NULL, never as = NULL', () => {
    expect(
      render({
        type: 'comparison',
        fieldMetadataId: FIELD_REGION,
        operator: 'eq',
        value: { source: 'literal', value: null },
      }),
    ).toEqual({
      sql: '("opportunity"."region" IS NULL)',
      parameters: {},
    });
  });

  it('should render an empty in list as FALSE and an empty notIn as TRUE', () => {
    expect(render(inEmpty).sql).toBe('(FALSE)');
    expect(render(notInEmpty).sql).toBe('(TRUE)');
  });

  it('should let a null column pass notIn', () => {
    expect(
      render({
        type: 'comparison',
        fieldMetadataId: FIELD_REGION,
        operator: 'notIn',
        value: { source: 'literalList', values: ['AMER'] },
      }),
    ).toEqual({
      sql: '("opportunity"."region" IS NULL OR NOT ("opportunity"."region" = ANY(:recordScope_opportunity_0)))',
      parameters: { recordScope_opportunity_0: ['AMER'] },
    });
  });

  it('should render isNull and isNotNull without binding a parameter', () => {
    expect(render(isNullRegion)).toEqual({
      sql: '("opportunity"."region" IS NULL)',
      parameters: {},
    });
  });

  it('should substitute the principal attribute as a bound parameter, never inline', () => {
    expect(render(ownedByMe)).toEqual({
      sql: '("opportunity"."ownerId" IS NOT DISTINCT FROM :recordScope_opportunity_0)',
      parameters: { recordScope_opportunity_0: 'wm-1' },
    });
  });

  it('should number parameters sequentially across a whole tree', () => {
    expect(render(andNode)).toEqual({
      sql: '(("opportunity"."region" IS NOT DISTINCT FROM :recordScope_opportunity_0) AND ("opportunity"."ownerId" IS NOT DISTINCT FROM :recordScope_opportunity_1))',
      parameters: {
        recordScope_opportunity_0: 'EMEA',
        recordScope_opportunity_1: 'wm-1',
      },
    });
  });

  it('should throw PERMISSION_DENIED when the field resolves to several columns', () => {
    expect(() =>
      render({
        type: 'comparison',
        fieldMetadataId: 'field-linkedin-link',
        operator: 'eq',
        value: { source: 'literal', value: 'x' },
      }),
    ).toThrow(PermissionsException);
  });

  it('should throw PERMISSION_DENIED when the field no longer resolves at all', () => {
    expect(() =>
      render({
        type: 'comparison',
        fieldMetadataId: 'field-renamed-away',
        operator: 'eq',
        value: { source: 'literal', value: 'x' },
      }),
    ).toThrow(PermissionsException);
  });
});

describe('evaluateRecordScope', () => {
  it.each(RECORD_SCOPE_CASES)(
    'should evaluate $name to $expected in memory',
    ({ node, row, expected }) => {
      expect(
        evaluateRecordScope({
          node,
          record: row,
          columnNamesByFieldMetadataId,
          principal,
        }),
      ).toBe(expected);
    },
  );
});
