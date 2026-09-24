import nextConfig from '@eve/eslint-config/next';

// K-11: Website tidak pernah mengakses database langsung, hanya lewat HTTP ke App Pusat.
export default nextConfig(['@eve/db', 'pg', 'kysely']);
