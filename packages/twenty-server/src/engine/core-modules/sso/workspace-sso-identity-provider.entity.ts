import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export enum IdentityProviderType {
  SAML = 'SAML',
  OIDC = 'OIDC',
}

registerEnumType(IdentityProviderType, { name: 'IdentityProviderType' });

export enum SSOIdentityProviderStatus {
  Active = 'Active',
  Inactive = 'Inactive',
}

registerEnumType(SSOIdentityProviderStatus, {
  name: 'SSOIdentityProviderStatus',
});

// Clean-room AGPL implementation. Schema is intentionally compatible with the
// existing `core.workspaceSSOIdentityProvider` table so existing identity
// provider rows keep working: same table/column names as introspected via
// consumer call sites (id, name, type, status, issuer, workspaceId), extended
// with the columns strictly required to perform SAML/OIDC verification
// server-side (never trust client-supplied provider config at auth time).
@Entity({ name: 'workspaceSSOIdentityProvider', schema: 'core' })
@ObjectType('SSOIdentityProvider')
export class WorkspaceSSOIdentityProviderEntity {
  @Field(() => UUIDScalarType)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ type: 'varchar' })
  name: string;

  @Field(() => IdentityProviderType)
  @Column({ type: 'varchar' })
  type: IdentityProviderType;

  @Field(() => SSOIdentityProviderStatus)
  @Column({ type: 'varchar', default: SSOIdentityProviderStatus.Inactive })
  status: SSOIdentityProviderStatus;

  // SAML: IdP entity id. OIDC: issuer URL (matched against the `iss` claim).
  @Field(() => String)
  @Column({ type: 'varchar' })
  issuer: string;

  // SAML: IdP SSO redirect/POST endpoint. OIDC: authorization endpoint base
  // (discovered from the issuer, this is a fallback / pinned override).
  @Column({ type: 'varchar', nullable: true })
  ssoUrl: string | null;

  // SAML: IdP signing certificate (PEM, x509). Required to validate the
  // assertion signature — this is the trust anchor, never accepted unverified.
  @Column({ type: 'text', nullable: true })
  certificate: string | null;

  // OIDC client credentials, issued by the IdP for this workspace's app registration.
  @Column({ type: 'varchar', nullable: true })
  clientID: string | null;

  @Column({ type: 'varchar', nullable: true })
  clientSecret: string | null;

  @Column({ type: 'uuid' })
  @Index()
  workspaceId: string;

  // String-based relation target (not a value import of WorkspaceEntity):
  // workspace.entity.ts already imports this entity by value for its own
  // inverse relation, so a value import back here would form a
  // require()-cycle that breaks under Jest's module resolution even though
  // it typechecks. TypeORM resolves the class by its registered entity name
  // at metadata-build time instead.
  @ManyToOne('WorkspaceEntity', (workspace: WorkspaceEntity) => workspace.workspaceSSOIdentityProviders, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspaceId' })
  workspace: WorkspaceEntity;

  @Field(() => ID, { nullable: true })
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
