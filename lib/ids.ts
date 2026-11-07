// У реальної бази (crm_*) ідентифікатори записів і власника — uuid. Перевірка
// живе тут, щоб сервер відхиляв сміттєві id ще до запиту до Postgres: інакше
// невалідний uuid у фільтрі дав би 500 замість зрозумілої помилки.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
