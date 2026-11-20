import { boundedText, ensure, numeric, type Input } from '@/lib/shared/validation';

export const kinds = ['text', 'boolean', 'number', 'choice'] as const;
export type ConfigKind = typeof kinds[number];
export type ConfigValue = string | boolean | number;
export const configKey = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const scopeType = /^[a-z][a-z0-9_]{0,62}$/;

export function keyName(input: unknown) {
  ensure(typeof input === 'string' && input.length <= 96 && configKey.test(input), 400, 'Clé de paramètre invalide');
  return input;
}

export function typedValue(kind: ConfigKind, input: unknown, form: boolean): ConfigValue {
  if (kind === 'number') return numeric(input);
  if (kind === 'boolean') {
    const value = form && ['true', 'false'].includes(String(input)) ? input === 'true' : input;
    ensure(typeof value === 'boolean', 400, 'Choisir Oui ou Non');
    return value;
  }
  return boundedText(input, 1000, 'Valeur');
}

export function definitionInput(input: Input, form: boolean) {
  ensure(kinds.includes(input.kind as ConfigKind), 400, 'Type de paramètre invalide');
  const kind = input.kind as ConfigKind;
  const choices = form && typeof input.choices === 'string'
    ? input.choices.split('\n').map(choice => choice.trim()).filter(Boolean)
    : input.choices ?? [];
  ensure(Array.isArray(choices) && choices.length <= 32 && new Set(choices).size === choices.length,
    400, 'Choix invalides');
  const options = choices.map(choice => boundedText(choice, 120, 'Choix'));
  ensure(new Set(options).size === options.length, 400, 'Les choix doivent être distincts');
  ensure((kind === 'choice') === (options.length > 0), 400, 'Renseigner les choix uniquement pour le type Liste');
  const allowedTypes = typeof input.allowedTypes === 'string' ? [input.allowedTypes] : input.allowedTypes;
  ensure(Array.isArray(allowedTypes) && allowedTypes.length > 0 && allowedTypes.length <= 32 &&
    new Set(allowedTypes).size === allowedTypes.length, 400, 'Types de portée requis');
  const types = allowedTypes.map(item => {
    ensure(typeof item === 'string' && scopeType.test(item), 400, 'Type de portée invalide');
    return item;
  });
  const minimum = input.minimum == null || input.minimum === '' ? null : numeric(input.minimum);
  const maximum = input.maximum == null || input.maximum === '' ? null : numeric(input.maximum);
  ensure(kind === 'number' || (minimum === null && maximum === null), 400, 'Bornes réservées aux nombres');
  ensure(minimum === null || maximum === null || minimum <= maximum, 400, 'Bornes incohérentes');
  const hasDefault = input.defaultValue !== undefined && input.defaultValue !== null && input.defaultValue !== '';
  if (!form) {
    ensure(
      typeof input.inherits === 'boolean' && typeof input.allowOverride === 'boolean',
      400, 'Options d’héritage requises',
    );
  }
  return {
    key: keyName(input.key),
    label: boundedText(input.label, 120, 'Libellé'),
    description: boundedText(input.description, 500, 'Description'),
    kind, options, types, minimum, maximum,
    defaultValue: hasDefault ? typedValue(kind, input.defaultValue, form) : null,
    inherits: form ? input.inherits === 'on' : input.inherits === true,
    allowOverride: form ? input.allowOverride === 'on' : input.allowOverride === true,
  };
}
