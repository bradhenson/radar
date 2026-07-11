// Fictional sample data (plan section 44). Never real personnel information.

import type { DatabaseSnapshot } from "./DataStore";
import { emptyCollections } from "./DataStore";
import {
  DEFAULT_BOARD_COLUMN_SEEDS,
  DEFAULT_SETTINGS,
  normalizeTaskStatus,
  type Employee,
  type Project,
  type Task,
  type TaskPriority,
  type TrainingRequirement
} from "../domain/models";
import { addDays, nowTimestamp, todayIso } from "../utils/dates";
import { newId } from "../utils/ids";
import { ORDER_GAP } from "../domain/rules/boardOrder";

export function createSampleSnapshot(): DatabaseSnapshot {
  const now = nowTimestamp();
  const today = todayIso();
  const c = emptyCollections();
  const stamp = { createdAt: now, updatedAt: now };
  const atNoon = (date: string) => `${date}T12:00:00.000Z`;

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

  const employeeSeeds = [
    ["Avery Brooks", comp55140.id, "Systems Engineer", "Systems Integration"],
    ["Riley Chen", comp55140.id, "Systems Engineer", "Systems Integration"],
    ["Morgan Patel", comp55140.id, "Test Engineer", "Verification"],
    ["Jamie Rivera", comp55140.id, "Test Engineer", "Verification"],
    ["Quinn Foster", comp55140.id, "Network Engineer", "Infrastructure"],
    ["Skyler Nguyen", comp55140.id, "Network Engineer", "Infrastructure"],
    ["Cameron Wright", comp55140.id, "Cybersecurity Analyst", "Cybersecurity"],
    ["Reese Carter", comp55140.id, "Cybersecurity Analyst", "Cybersecurity"],
    ["Jordan Kim", comp55140.id, "Integration Lead", "Systems Integration"],
    ["Taylor Ellis", comp55140.id, "Configuration Manager", "Configuration"],
    ["Casey Vaughn", comp55140.id, "Software Engineer", "Software"],
    ["Alex Monroe", comp55140.id, "Software Engineer", "Software"],
    ["Drew Bennett", comp55140.id, "Data Analyst", "Analytics"],
    ["Harper Lane", comp55140.id, "Data Analyst", "Analytics"],
    ["Parker Reed", comp55140.id, "Project Analyst", "Project Controls"],
    ["Rowan Brooks", comp55140.id, "Project Analyst", "Project Controls"],
    ["Sidney Clarke", comp55140.id, "Logistics Specialist", "Logistics"],
    ["Emerson Hayes", comp55140.id, "Technical Writer", "Documentation"],
    ["Finley Adams", comp55140.id, "Training Coordinator", "Training"],
    ["Dakota Price", comp55140.id, "Operations Analyst", "Operations"],
    ["Blake Turner", comp55230.id, "Software Engineer", "Software"],
    ["Kendall Moore", comp55230.id, "Software Engineer", "Software"],
    ["Robin Jenkins", comp55230.id, "Systems Engineer", "Systems Integration"],
    ["Hayden Scott", comp55230.id, "Systems Engineer", "Systems Integration"],
    ["Logan Pierce", comp55230.id, "Test Engineer", "Verification"],
    ["Marlowe Grant", comp55230.id, "Test Engineer", "Verification"],
    ["Devin Cooper", comp55230.id, "Cybersecurity Analyst", "Cybersecurity"],
    ["Aliyah Stone", comp55230.id, "Cybersecurity Analyst", "Cybersecurity"],
    ["Nia Coleman", comp55230.id, "Project Analyst", "Project Controls"],
    ["Mateo Hayes", comp55230.id, "Project Analyst", "Project Controls"],
    ["Priya Shah", comp55230.id, "Data Analyst", "Analytics"],
    ["Elise Warren", comp55230.id, "Data Analyst", "Analytics"],
    ["Noah Sterling", comp55230.id, "Network Engineer", "Infrastructure"],
    ["Maya Ortiz", comp55230.id, "Network Engineer", "Infrastructure"],
    ["Ethan Blake", comp55230.id, "Technical Writer", "Documentation"],
    ["Iris Bennett", comp55230.id, "Training Coordinator", "Training"],
    ["Leo Ramsey", comp55230.id, "Operations Analyst", "Operations"],
    ["Clara Jensen", comp55230.id, "Configuration Manager", "Configuration"],
    ["Owen Park", comp55230.id, "Logistics Specialist", "Logistics"],
    ["Tessa Miller", comp55230.id, "Integration Lead", "Systems Integration"]
  ] as const;

  const employees = employeeSeeds.map(([displayName, competencyId, positionTitle, team], index) =>
    emp(displayName, competencyId, positionTitle, team, index)
  );
  c.employees.push(...employees);

  function emp(displayName: string, competencyId: string, positionTitle: string, team: string, index: number): Employee {
    return {
      id: newId(),
      displayName,
      competencyId,
      positionTitle,
      team,
      workEmail: `${displayName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.invalid`,
      startDate: addDays(today, -1200 + index * 17),
      lastCheckInDate: index % 6 === 0 ? addDays(today, -45) : addDays(today, -((index % 20) + 5)),
      activeStatus: "active",
      tags: [team],
      isArchived: false,
      ...stamp
    };
  }

  const projects = {
    lighthouse: proj("Project Lighthouse", "LH", employees[0]!, comp55140.id),
    harbor: proj("Project Harbor", "HB", employees[20]!, comp55230.id),
    training: proj("Internal Training Improvement", "ITI", employees[18]!, comp55140.id),
    workforce: proj("Competency Workforce Planning", "CWP", employees[29]!, comp55230.id),
    reporting: proj("Customer Reporting Modernization", "CRM", employees[12]!, comp55140.id),
    knowledge: proj("Knowledge Base Refresh", "KBR", employees[34]!, comp55230.id)
  };
  c.projects.push(...Object.values(projects));

  function proj(name: string, shortName: string, lead: Employee, competencyId: string): Project {
    return {
      id: newId(),
      name,
      shortName,
      status: "active",
      leadEmployeeId: lead.id,
      competencyId,
      startDate: addDays(today, -120),
      targetEndDate: addDays(today, 150),
      tags: [],
      isArchived: false,
      ...stamp
    };
  }

  c.performanceElements.push(
    { id: newId(), name: "Mission Delivery", description: "Completes work that advances mission outcomes.", active: true },
    { id: newId(), name: "Technical Quality", description: "Produces accurate, maintainable technical work.", active: true },
    { id: newId(), name: "Collaboration", description: "Works effectively across teams and stakeholders.", active: true },
    { id: newId(), name: "Customer Focus", description: "Maintains clear communication and customer confidence.", active: true },
    { id: newId(), name: "Leadership", description: "Leads work, removes blockers, and mentors others.", active: true }
  );
  const cycle = {
    id: newId(),
    name: "FY26 Evaluation Cycle",
    startDate: "2025-10-01",
    endDate: "2026-09-30",
    midyearDate: "2026-04-01",
    active: true
  };
  c.evaluationCycles.push(cycle);

  const columnOrders = new Map<string, number>();
  const nextOrder = (columnId: string) => {
    const order = (columnOrders.get(columnId) ?? 0) + ORDER_GAP;
    columnOrders.set(columnId, order);
    return order;
  };

  function task(title: string, column: string, priority: TaskPriority, overrides: Partial<Task> = {}): Task {
    const boardColumnId = overrides.boardColumnId ?? column;
    return {
      id: newId(),
      title,
      status: normalizeTaskStatus(column),
      boardColumnId,
      priority,
      performanceInputCreated: false,
      tags: [],
      boardOrder: nextOrder(boardColumnId),
      isArchived: false,
      ...stamp,
      ...overrides
    };
  }

  const tasks = [
    task("Review weekly timekeeping exceptions", "inbox", "normal", {
      dueDate: addDays(today, 2),
      description: "Supervisor-owned weekly review before timecards are certified.",
      showOnCard: "description"
    }),
    task("Prepare Friday status rollup", "in_progress", "normal", {
      dueDate: addDays(today, 5),
      projectId: projects.workforce.id,
      description: "Pull project, training, leave, and telework highlights into one weekly summary.",
      showOnCard: "description"
    }),
    task("Update branch staffing summary", "inbox", "high", {
      dueDate: addDays(today, 8),
      projectId: projects.workforce.id,
      description: "Refresh staffing changes, vacancies, and upcoming availability constraints."
    }),
    task("Reconcile pending telework requests", "inbox", "normal", {
      dueDate: addDays(today, 1),
      description: "Review pending situational requests and capture source references."
    }),
    task("Compile performance input reminders", "inbox", "normal", {
      dueDate: addDays(today, 6),
      description: "Check employees without recent inputs and identify accomplishments to capture."
    }),
    task("Review customer demo logistics", "waiting", "high", {
      projectId: projects.harbor.id,
      waitingSince: atNoon(addDays(today, -18)),
      sourceSystem: "Email"
    }),
    task("Confirm leave coverage for next sprint", "inbox", "normal", {
      dueDate: addDays(today, 4),
      description: "Use the leave records and project staffing view to confirm coverage."
    }),
    task("Refresh training exception list", "in_progress", "normal", {
      dueDate: addDays(today, 3),
      projectId: projects.training.id,
      showOnCard: "checklist"
    }),
    task("Draft onboarding checklist for incoming employees", "inbox", "normal", {
      dueDate: addDays(today, 14)
    }),
    task("Review project risk register", "inbox", "normal", {
      projectId: projects.lighthouse.id,
      dueDate: addDays(today, 10)
    }),
    task("Archive completed meeting notes", "inbox", "low", {
      dueDate: addDays(today, 12)
    }),
    task("Verify annual cybersecurity training record", "waiting", "normal", {
      employeeId: employees[2]!.id,
      competencyId: employees[2]!.competencyId,
      waitingSince: atNoon(addDays(today, -16)),
      sourceSystem: "SWAT"
    }),
    task("Prepare telework renewal follow-up", "in_progress", "normal", {
      employeeId: employees[10]!.id,
      competencyId: employees[10]!.competencyId,
      dueDate: addDays(today, 7),
      description: "Current agreement expires this quarter. Confirm the renewal packet is started and the schedule summary is accurate.",
      showOnCard: "description"
    }),
    task("Capture Project Harbor customer recognition", "in_progress", "normal", {
      employeeId: employees[23]!.id,
      projectId: projects.harbor.id,
      competencyId: employees[23]!.competencyId
    }),
    task("Review Project Lighthouse test schedule", "inbox", "high", {
      employeeId: employees[0]!.id,
      projectId: projects.lighthouse.id,
      competencyId: employees[0]!.competencyId,
      dueDate: addDays(today, 7),
      showOnCard: "checklist"
    }),
    task("Complete recognition package draft", "in_progress", "normal", {
      employeeId: employees[7]!.id,
      projectId: projects.reporting.id,
      competencyId: employees[7]!.competencyId,
      dueDate: addDays(today, 9)
    }),
    task("Close out completed sprint retrospective", "complete", "normal", {
      completedDate: addDays(today, -2),
      performanceInputCreated: true,
      projectId: projects.knowledge.id
    }),
    task("Document automation win from reporting project", "complete", "normal", {
      employeeId: employees[12]!.id,
      projectId: projects.reporting.id,
      competencyId: employees[12]!.competencyId,
      completedDate: addDays(today, -1),
      performanceInputCreated: false
    })
  ];
  c.tasks.push(...tasks);

  addChecklist(tasks[7]!, ["Export current training roster", "Identify overdue employees", "Send reminder summary"], [0, 1]);
  addChecklist(tasks[14]!, ["Confirm lab availability", "Review test entrance criteria", "Update integrated schedule"], [0]);
  addTaskNote(tasks[17]!, "completion", "Created a reusable reporting query and documented the handoff steps.");

  function addChecklist(taskRecord: Task, titles: string[], completeIndexes: number[]) {
    titles.forEach((title, i) =>
      c.checklistItems.push({
        id: newId(),
        taskId: taskRecord.id,
        title,
        isComplete: completeIndexes.includes(i),
        completedAt: completeIndexes.includes(i) ? now : undefined,
        order: i + 1
      })
    );
  }

  function addTaskNote(taskRecord: Task, noteType: "general" | "status" | "decision" | "completion" | "verification", body: string) {
    c.taskNotes.push({ id: newId(), taskId: taskRecord.id, body, noteType, ...stamp });
  }

  const contexts = [
    "Customer delivery required cross-team coordination during a compressed schedule.",
    "A recurring data-quality issue was slowing down weekly review.",
    "The project team needed a clearer handoff path for test evidence.",
    "A stakeholder request changed late in the sprint and required careful reprioritization.",
    "The team needed better visibility into training and availability risks."
  ];
  const actions = [
    "Coordinated the revised task sequence and kept stakeholders informed.",
    "Built a repeatable checklist and coached teammates through the process.",
    "Analyzed the issue, documented the fix, and briefed the project lead.",
    "Led the working session that resolved the blocker and assigned next actions.",
    "Prepared a concise summary that helped the team make a timely decision."
  ];
  const results = [
    "The team completed the work without missing the adjusted milestone.",
    "Review time decreased and fewer corrections were needed.",
    "The handoff package was accepted on first review.",
    "The blocker was cleared before it affected the customer commitment.",
    "Leadership had a clear picture of risks, owners, and next steps."
  ];
  employees.slice(0, 26).forEach((employee, i) => {
    c.performanceInputs.push({
      id: newId(),
      employeeId: employee.id,
      inputDate: addDays(today, -(i * 9 + 3)),
      situationOrContext: contexts[i % contexts.length]!,
      actionOrAccomplishment: actions[i % actions.length]!,
      result: i % 7 === 0 ? undefined : results[i % results.length]!,
      performanceElementId: c.performanceElements[i % c.performanceElements.length]!.id,
      projectId: Object.values(projects)[i % Object.values(projects).length]!.id,
      evaluationCycleId: cycle.id,
      source: i % 4 === 0 ? "Meeting" : "Supervisor",
      inputStatus: i % 6 === 0 ? "draft" : "ready",
      recognitionPotential: i % 8 === 0,
      tags: [],
      isArchived: false,
      ...stamp
    });
  });

  c.meetingNotes.push(
    meeting("Product team backlog review", "Product team", 0, projects.harbor, [0, 10, 20, 23]),
    meeting("Training exception review", "Staff", -2, projects.training, [2, 18, 35, 39]),
    meeting("Project Lighthouse test readiness", "Project", -5, projects.lighthouse, [0, 3, 8, 14]),
    meeting("Customer reporting modernization sync", "Customer", 3, projects.reporting, [12, 13, 31, 32]),
    meeting("Telework request review", "Staff", 5, undefined, [10, 11, 27, 33]),
    meeting("Knowledge base refresh planning", "Project", 8, projects.knowledge, [17, 34, 37, 39])
  );

  function meeting(title: string, meetingType: string, offset: number, project: Project | undefined, indexes: number[]) {
    return {
      id: newId(),
      meetingDate: addDays(today, offset),
      title,
      meetingType,
      projectId: project?.id,
      attendeeEmployeeIds: indexes.map((i) => employees[i]!.id),
      notes: "Reviewed current status, upcoming constraints, and decisions needed before the next checkpoint.",
      actionItems: "Capture follow-up actions in RADAR and confirm owner/date before the next meeting.",
      isArchived: false,
      ...stamp
    };
  }

  const trainingRequirements = [
    req("Annual Cybersecurity Awareness", "annual", 21, "all"),
    req("Privacy and Records Management", "annual", 45, "all"),
    req("Confidential Information Handling", "annual", 12, "all"),
    req("Operational Risk Awareness", "annual", -7, "all"),
    req("Safety and Emergency Procedures", "annual", 90, "all"),
    req("Records Retention Basics", "annual", 7, "all"),
    req("Travel Card Refresher", "none", 25, "selected", employeeIndexes([2, 7, 12, 17, 22, 27, 32, 37])),
    req("Secure Development Practices", "annual", 35, "selected", employees.slice(0, 20).map((e) => e.id)),
    req("Lab Safety Orientation", "none", -3, "selected", employeeIndexes([0, 4, 8, 12, 16, 20, 24, 28, 32, 36])),
    {
      id: newId(),
      name: "Systems Access Review",
      recurrenceType: "months" as const,
      recurrenceInterval: 12,
      assignmentScope: "all" as const,
      warningDays: [45, 30, 14],
      active: true,
      ...stamp
    }
  ];
  c.trainingRequirements.push(...trainingRequirements);

  function req(
    name: string,
    recurrenceType: "none" | "annual",
    dueOffset: number,
    assignmentScope: "all" | "selected",
    assignedEmployeeIds?: string[]
  ): TrainingRequirement {
    return {
      id: newId(),
      name,
      recurrenceType,
      recurrenceInterval: 1,
      dueDate: addDays(today, dueOffset),
      assignmentScope,
      assignedEmployeeIds,
      warningDays: [30, 14, 7],
      active: true,
      ...stamp
    };
  }

  function employeeIndexes(indexes: number[]): string[] {
    return indexes.map((i) => employees[i]!.id);
  }

  const [cyberReq, privacyReq, informationReq, riskReq, safetyReq, recordsReq, travelReq, secureReq, labReq, accessReq] =
    trainingRequirements;

  employees.forEach((employee, i) => {
    if (i % 5 !== 0) completeTraining(employee, cyberReq!, -35 - (i % 12));
    if (i % 3 === 0) completeTraining(employee, privacyReq!, -60 - (i % 20));
    if (i % 4 !== 0) completeTraining(employee, informationReq!, -20 - (i % 15));
    if (i % 3 !== 1) completeTraining(employee, riskReq!, -45 - (i % 18));
    if (i % 6 === 0) completeTraining(employee, safetyReq!, -15 - (i % 10));
    if (i % 2 === 0) completeTraining(employee, recordsReq!, -25 - (i % 12));
    if (i % 4 === 0) completeTraining(employee, accessReq!, -330 + (i % 18));
  });

  employeeIndexes([2, 7, 12]).forEach((id) => completeTraining(employees.find((e) => e.id === id)!, travelReq!, -10));
  employeeIndexes([0, 4, 8, 12, 16]).forEach((id) => completeTraining(employees.find((e) => e.id === id)!, labReq!, -20));
  employees.slice(0, 20).forEach((employee, i) => {
    if (i % 2 === 0) completeTraining(employee, secureReq!, -40 - i);
  });
  c.employeeTrainingRecords.push({
    id: newId(),
    employeeId: employees[5]!.id,
    trainingRequirementId: cyberReq!.id,
    status: "waived",
    notes: "Waived this cycle - extended detail assignment.",
    ...stamp
  });
  c.employeeTrainingRecords.push({
    id: newId(),
    employeeId: employees[9]!.id,
    trainingRequirementId: labReq!.id,
    status: "not_applicable",
    notes: "No lab access required for this role.",
    ...stamp
  });
  c.employeeTrainingRecords.push({
    id: newId(),
    employeeId: employees[21]!.id,
    trainingRequirementId: recordsReq!.id,
    dueDate: addDays(today, 3),
    status: "assigned",
    notes: "Earlier due date for records custodian backup.",
    ...stamp
  });

  function completeTraining(employee: Employee, requirement: TrainingRequirement, completedOffset: number) {
    c.employeeTrainingRecords.push({
      id: newId(),
      employeeId: employee.id,
      trainingRequirementId: requirement.id,
      completedDate: addDays(today, completedOffset),
      status: "complete",
      evidenceReference: "Synthetic transcript entry",
      sourceSystem: "SWAT",
      lastVerifiedDate: addDays(today, -((Math.abs(completedOffset) % 30) + 1)),
      ...stamp
    });
  }

  for (let i = 0; i < 18; i++) {
    const employee = employees[(i * 2 + 1) % employees.length]!;
    c.leaveRecords.push({
      id: newId(),
      employeeId: employee.id,
      leaveType: i % 5 === 0 ? "Sick" : i % 4 === 0 ? "Credit Hours" : "Annual",
      startDate: addDays(today, i * 3 - 6),
      endDate: addDays(today, i * 3 - 4),
      status: i % 6 === 0 ? "requested" : "approved",
      sourceSystem: "ERP",
      sourceReference: `Synthetic leave record ${i + 1}`,
      workloadImpactNote: i % 3 === 0 ? "Confirm project coverage before the start date." : undefined,
      ...stamp
    });
  }

  for (let i = 0; i < 24; i++) {
    const employee = employees[(i * 3 + 2) % employees.length]!;
    const situational = i % 4 === 0;
    c.teleworkRecords.push({
      id: newId(),
      employeeId: employee.id,
      recordType: situational ? "Situational request" : i % 5 === 0 ? "Renewal" : "Agreement",
      requestDate: addDays(today, -((i % 10) + 1)),
      effectiveDate: addDays(today, situational ? i + 1 : -90 + i),
      expirationDate: addDays(today, situational ? i + 1 : 30 + i * 4),
      status: situational
        ? (["pending", "approved", "denied", "cancelled"] as const)[(i / 4) % 4]!
        : i % 7 === 0
          ? "pending_approval"
          : "active",
      scheduleSummary: situational ? "One-day remote work request for focused analysis." : "Hybrid schedule captured for planning.",
      sourceSystem: "Email",
      sourceReference: `Synthetic telework reference ${i + 1}`,
      ...stamp
    });
  }

  const travelDestinations = [
    "San Diego, CA",
    "Washington, DC",
    "Huntsville, AL",
    "Dayton, OH",
    "Orlando, FL",
    "Colorado Springs, CO",
    "Norfolk, VA"
  ];
  for (let i = 0; i < 7; i++) {
    const employee = employees[(i * 5 + 4) % employees.length]!;
    const start = addDays(today, i * 6 - 8);
    const end = addDays(start, 2 + (i % 3));
    const iptConcurrence = (["concurred", "pending", "not_required"] as const)[i % 3]!;
    const dtsAuthorizationStatus = (["approved", "created", "not_started"] as const)[i % 3]!;
    c.travelRecords.push({
      id: newId(),
      employeeId: employee.id,
      destination: travelDestinations[i % travelDestinations.length]!,
      startDate: start,
      endDate: end,
      iptConcurrence,
      dtsAuthorizationStatus,
      dtsAuthorizationId: dtsAuthorizationStatus === "not_started" ? undefined : `A${(240000 + i * 137).toString()}`,
      voucherDueDate: addDays(end, 5),
      notes: i % 4 === 0 ? "Conference travel; coordinate coverage during the trip." : undefined,
      ...stamp
    });
  }

  for (let i = 0; i < 8; i++) {
    const employee = employees[(i * 4 + 3) % employees.length]!;
    c.awardRecords.push({
      id: newId(),
      employeeId: employee.id,
      awardType: i % 2 === 0 ? "On-the-spot" : "Time-off",
      title: `${employee.displayName} recognition package`,
      accomplishmentPeriodStart: addDays(today, -90),
      accomplishmentPeriodEnd: addDays(today, -5),
      nominationDueDate: addDays(today, 20 + i * 3),
      status: i % 3 === 0 ? "Drafting" : "Idea",
      projectId: Object.values(projects)[i % Object.values(projects).length]!.id,
      relatedPerformanceInputIds: [],
      supportingNotes: "Synthetic recognition example for sample data.",
      ...stamp
    });
  }

  employees.forEach((employee, i) => {
    if (i % 3 === 0) {
      c.employeeInteractions.push({
        id: newId(),
        employeeId: employee.id,
        interactionDate: addDays(today, -((i % 25) + 4)),
        interactionType: i % 2 === 0 ? "Informal check-in" : "Project discussion",
        summary: "Synthetic check-in summary for workload, training, and near-term support needs.",
        followUpRequired: i % 9 === 0,
        ...stamp
      });
    }
  });

  c.employeeNotes.push(
    empNote(employees[0]!, "Prefers written taskers over verbal; follow hallway requests with a short email."),
    empNote(employees[0]!, "Working toward a systems engineering certification; interested in stretch assignments."),
    empNote(employees[10]!, "Handles school drop-off in the mornings; avoid scheduling meetings before 0900."),
    empNote(employees[23]!, "Strong customer-brief skills; good candidate to lead the next demo.")
  );

  function empNote(employee: Employee, noteText: string) {
    return { id: newId(), employeeId: employee.id, noteText, isArchived: false, ...stamp };
  }

  return {
    collections: c,
    settings: { ...DEFAULT_SETTINGS, userDisplayName: "Sample Supervisor" },
    meta: { databaseId: newId(), changesSinceBackup: 0 }
  };
}
