import { RolesPage } from '../RolesPage';

/** Roles & permissions, inside the Administration rail. */
export const RolesPanel = ({ orgId }: { orgId: string }) => <RolesPage embedded orgId={orgId} />;
