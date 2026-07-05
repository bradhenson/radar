// Fictional sample data (plan section 44). Never real personnel information.

import type { DatabaseSnapshot } from "./DataStore";
import { emptyCollections } from "./DataStore";
import { DEFAULT_BOARD_COLUMN_SEEDS, DEFAULT_SETTINGS, DEFAULT_TASK_CATEGORY_SEEDS } from "../domain/models";
import { addDays, nowTimestamp, todayIso } from "../utils/dates";
import { newId } from "../utils/ids";
import { ORDER_GAP } from "../domain/rules/boardOrder";

export function createSampleSnapshot(): DatabaseSnapshot {
  const now = nowTimestamp();
  const today = todayIso();
  const c = emptyCollections();
  const stamp = { createdAt: now, updatedAt: now };

  c.taskCategories.push(
    ...DEFAULT_TASK_CATEGORY_SEEDS.map((category) => ({
      id: category.id,
      label: category.label,
      sortOrder: category.sortOrder,
      isArchived: false,
      ...stamp
    }))
  );
  c.boardColumns.push(
    ...DEFAULT_BOARD_COLUMN_SEEDS.map((column) => ({
      id: column.id,
      label: column.label,
      sortOrder: column.sortOrder,
      ...stamp
    }))
  );

  const comp55140 = { id: newId(), code: "55140", name: "Competency 55140", active: true, ...stamp };
  const comp55230 = { id: newId(), code: "55230", name: "Competency 55230", active: true, ...stamp };
  c.competencies.push(comp55140, comp55230);

  const alex = emp("Alex Morgan", comp55140.id, "Systems Engineer");
  const jordan = emp("Jordan Lee", comp55140.id, "Test Engineer");
  const casey = emp("Casey Smith", comp55230.id, "Software Engineer");
  const taylor = emp("Taylor Brown", comp55230.id, "Project Analyst");
  c.employees.push(alex, jordan, casey, taylor);

  function emp(displayName: string, competencyId: string, positionTitle: string) {
    return {
      id: newId(),
      displayName,
      competencyId,
      positionTitle,
      activeStatus: "active" as const,
      tags: [],
      isArchived: false,
      ...stamp
    };
  }

  const lighthouse = proj("Project Lighthouse", "LH");
  const harbor = proj("Project Harbor", "HB");
  const training = proj("Internal Training Improvement", "ITI");
  const workforce = proj("Competency Workforce Planning", "CWP");
  c.projects.push(lighthouse, harbor, training, workforce);

  function proj(name: string, shortName: string) {
    return { id: newId(), name, shortName, status: "active" as const, tags: [], isArchived: false, ...stamp };
  }

  let order = 0;
  const nextOrder = () => (order += ORDER_GAP);

  c.tasks.push(
    {
      id: newId(),
      title: "Review Project Lighthouse test schedule",
      status: "planned",
      boardColumnId: "planned",
      priority: "high",
      category: "project",
      employeeId: alex.id,
      projectId: lighthouse.id,
      competencyId: comp55140.id,
      dueDate: addDays(today, 7),
      performanceInputCreated: false,
      tags: [],
      boardOrder: nextOrder(),
      isArchived: false,
      ...stamp
    },
    {
      id: newId(),
      title: "Verify annual cybersecurity training",
      status: "waiting",
      boardColumnId: "waiting",
      priority: "normal",
      category: "training",
      employeeId: jordan.id,
      competencyId: comp55140.id,
      waitingOn: "Updated SWAT record",
      waitingReason: "Waiting for the authoritative record to update",
      waitingSince: now,
      sourceSystem: "SWAT",
      performanceInputCreated: false,
      tags: [],
      boardOrder: nextOrder(),
      isArchived: false,
      ...stamp
    },
    {
      id: newId(),
      title: "Prepare telework renewal follow-up",
      status: "inbox",
      boardColumnId: "inbox",
      priority: "normal",
      category: "administrative",
      employeeId: casey.id,
      competencyId: comp55230.id,
      performanceInputCreated: false,
      tags: [],
      boardOrder: nextOrder(),
      isArchived: false,
      ...stamp
    },
    {
      id: newId(),
      title: "Capture Project Harbor customer recognition",
      status: "needs_review",
      boardColumnId: "needs_review",
      priority: "normal",
      category: "performance",
      employeeId: taylor.id,
      projectId: harbor.id,
      competencyId: comp55230.id,
      performanceInputCreated: false,
      tags: [],
      boardOrder: nextOrder(),
      isArchived: false,
      ...stamp
    },
    {
      id: newId(),
      title: "Weekly timekeeping review",
      status: "planned",
      boardColumnId: "planned",
      priority: "normal",
      category: "administrative",
      dueDate: addDays(today, 3),
      performanceInputCreated: false,
      tags: ["recurring"],
      boardOrder: nextOrder(),
      isArchived: false,
      ...stamp
    }
  );

  // Demonstrate the Planner-style card previews.
  const lighthouseTask = c.tasks[0]!;
  lighthouseTask.showOnCard = "checklist";
  ["Confirm lab availability", "Review test entrance criteria", "Update integrated schedule"].forEach((title, i) =>
    c.checklistItems.push({
      id: newId(),
      taskId: lighthouseTask.id,
      title,
      isComplete: i === 0,
      completedAt: i === 0 ? now : undefined,
      order: i + 1
    })
  );
  const teleworkTask = c.tasks[2]!;
  teleworkTask.description =
    "Current agreement expires this quarter. Confirm the renewal packet is started and the schedule summary is still accurate.";
  teleworkTask.showOnCard = "description";

  c.performanceInputs.push({
    id: newId(),
    employeeId: taylor.id,
    inputDate: today,
    situationOrContext: "Project Harbor required a revised delivery approach after a schedule change.",
    actionOrAccomplishment: "Coordinated the revised task sequence and maintained communication with project stakeholders.",
    result: "The team completed the revised deliverables without missing the adjusted milestone.",
    impact: "Reduced schedule risk and preserved customer confidence.",
    projectId: harbor.id,
    source: "Supervisor",
    inputStatus: "ready",
    recognitionPotential: true,
    tags: [],
    isArchived: false,
    ...stamp
  });

  const cyberReq = {
    id: newId(),
    name: "Annual Cybersecurity Awareness",
    recurrenceType: "annual" as const,
    recurrenceInterval: 1,
    warningDays: [30, 14, 7],
    active: true,
    ...stamp
  };
  c.trainingRequirements.push(cyberReq);

  for (const e of [alex, jordan, casey, taylor]) {
    c.employeeTrainingRecords.push({
      id: newId(),
      employeeId: e.id,
      trainingRequirementId: cyberReq.id,
      dueDate: addDays(today, e === jordan ? 10 : 45),
      status: "assigned",
      ...stamp
    });
  }

  c.leaveRecords.push({
    id: newId(),
    employeeId: alex.id,
    leaveType: "Annual",
    startDate: addDays(today, 10),
    endDate: addDays(today, 14),
    status: "approved",
    ...stamp
  });

  c.teleworkRecords.push({
    id: newId(),
    employeeId: casey.id,
    recordType: "Agreement",
    effectiveDate: addDays(today, -300),
    expirationDate: addDays(today, 21),
    status: "active",
    scheduleSummary: "Situational, 2 days per week",
    ...stamp
  });

  return {
    collections: c,
    settings: { ...DEFAULT_SETTINGS },
    meta: { databaseId: newId(), changesSinceBackup: 0 }
  };
}
