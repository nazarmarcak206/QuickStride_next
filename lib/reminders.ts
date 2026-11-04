import type { Client, Project } from "./types";

// Зв'язки справи (клієнт і проєкт) — підзвітні, а не заборонені: помилкову
// прив'язку показуємо текстом, але збереження не блокуємо.

export function projectOwnerName(clients: Client[], project: Project): string | null {
  return clients.find((client) => client.id === project.clientId)?.name ?? null;
}

export function reminderLinkMismatch(
  clients: Client[],
  projects: Project[],
  link: { clientId: string; projectId: string }
): string | null {
  if (!link.clientId || !link.projectId) return null;
  const project = projects.find((item) => item.id === link.projectId);
  const selected = clients.find((client) => client.id === link.clientId);
  if (!project || !selected) return null;
  const owner = projectOwnerName(clients, project);
  if (!owner || project.clientId === selected.id) return null;
  return (
    `Клієнт справи — ${selected.name}, а клієнт проєкту «${project.title}» — ${owner}. ` +
    `Зберегти можна; перев'яжіть, якщо це помилка.`
  );
}
