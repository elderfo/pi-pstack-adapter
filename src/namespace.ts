export const DEFAULT_NAMESPACE = "pistack";

const NAMESPACE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateNamespace(value: string): string {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new Error(
      `Invalid pstack adapter namespace ${JSON.stringify(value)}. Use lowercase letters, digits, and single hyphens.`,
    );
  }
  return value;
}

export function namespaced(namespace: string, name: string): string {
  return `${namespace}-${name}`;
}
