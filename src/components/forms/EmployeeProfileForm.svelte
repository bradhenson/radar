<script lang="ts">
  import Dialog from "../common/Dialog.svelte";
  import { app } from "../../stores/app.svelte";
  import { CLEARANCE_OPTIONS, COMPUTER_ASSET_OPTIONS, type Employee } from "../../domain/models";
  import { nowTimestamp } from "../../utils/dates";

  type YesNoBlank = "" | "yes" | "no";

  let { employee, onclose }: { employee: Employee; onclose: () => void } = $props();

  const clean = (value: string) => value.trim() || undefined;
  const yesNoState = (value: boolean | undefined): YesNoBlank => (value === undefined ? "" : value ? "yes" : "no");
  const yesNoValue = (value: YesNoBlank): boolean | undefined => (value === "" ? undefined : value === "yes");

  let initialized = $state(false);
  let edipi = $state("");
  let pernr = $state("");
  let series = $state("");
  let positionTitle = $state("");
  let workEmail = $state("");
  let locationBuilding = $state("");
  let locationCube = $state("");
  let workPhone = $state("");
  let personalPhone = $state("");
  let team = $state("");
  let iptLead = $state("");
  let employeeProject = $state("");
  let employeeProjectLead = $state("");
  let computerAsset = $state<Employee["computerAsset"] | "">("");
  let govPhone = $state<YesNoBlank>("");
  let cswfCode = $state("");
  let cswfLevel = $state("");
  let financialStatementRequired = $state<YesNoBlank>("");
  let drugTestRequired = $state<YesNoBlank>("");
  let teleworkAgreementValidThrough = $state("");
  let clearance = $state<Employee["clearance"] | "">("");

  $effect(() => {
    if (initialized) return;
    edipi = employee.edipi ?? "";
    pernr = employee.pernr ?? "";
    series = employee.series ?? "";
    positionTitle = employee.positionTitle ?? "";
    workEmail = employee.workEmail ?? "";
    locationBuilding = employee.locationBuilding ?? "";
    locationCube = employee.locationCube ?? "";
    workPhone = employee.workPhone ?? "";
    personalPhone = employee.personalPhone ?? "";
    team = employee.team ?? "";
    iptLead = employee.iptLead ?? "";
    employeeProject = employee.employeeProject ?? "";
    employeeProjectLead = employee.employeeProjectLead ?? "";
    computerAsset = employee.computerAsset ?? "";
    govPhone = yesNoState(employee.govPhone);
    cswfCode = employee.cswfCode ?? "";
    cswfLevel = employee.cswfLevel ?? "";
    financialStatementRequired = yesNoState(employee.financialStatementRequired);
    drugTestRequired = yesNoState(employee.drugTestRequired);
    teleworkAgreementValidThrough = employee.teleworkAgreementValidThrough ?? "";
    clearance = employee.clearance ?? "";
    initialized = true;
  });

  async function save() {
    const record: Employee = {
      ...employee,
      edipi: clean(edipi),
      pernr: clean(pernr),
      series: clean(series),
      positionTitle: clean(positionTitle),
      workEmail: clean(workEmail),
      locationBuilding: clean(locationBuilding),
      locationCube: clean(locationCube),
      workPhone: clean(workPhone),
      personalPhone: clean(personalPhone),
      team: clean(team),
      iptLead: clean(iptLead),
      employeeProject: clean(employeeProject),
      employeeProjectLead: clean(employeeProjectLead),
      computerAsset: computerAsset || undefined,
      govPhone: yesNoValue(govPhone),
      cswfCode: clean(cswfCode),
      cswfLevel: clean(cswfLevel),
      financialStatementRequired: yesNoValue(financialStatementRequired),
      drugTestRequired: yesNoValue(drugTestRequired),
      teleworkAgreementValidThrough: teleworkAgreementValidThrough || undefined,
      clearance: clearance || undefined,
      updatedAt: nowTimestamp()
    };
    await app.putRecord("employees", record, {
      actionType: "updated",
      summary: `Updated profile details for ${employee.displayName}`
    });
    onclose();
  }
</script>

<Dialog title="Edit Profile Details" wide {onclose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <section class="form-section">
      <h3>Identity</h3>
      <div class="form-grid">
        <div class="field">
          <label for="ep-title">Title</label>
          <input id="ep-title" type="text" bind:value={positionTitle} maxlength="200" />
        </div>
        <div class="field">
          <label for="ep-series">Series</label>
          <input id="ep-series" type="text" bind:value={series} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-edipi">EDIPI</label>
          <input id="ep-edipi" type="text" bind:value={edipi} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-pernr">PERNR</label>
          <input id="ep-pernr" type="text" bind:value={pernr} maxlength="50" />
        </div>
      </div>
    </section>

    <section class="form-section">
      <h3>Location and Contact</h3>
      <div class="form-grid">
        <div class="field">
          <label for="ep-building">Building</label>
          <input id="ep-building" type="text" bind:value={locationBuilding} maxlength="100" />
        </div>
        <div class="field">
          <label for="ep-cube">Cube</label>
          <input id="ep-cube" type="text" bind:value={locationCube} maxlength="100" />
        </div>
        <div class="field">
          <label for="ep-email">Work email</label>
          <input id="ep-email" type="text" bind:value={workEmail} maxlength="200" />
        </div>
        <div class="field">
          <label for="ep-work-phone">Work phone</label>
          <input id="ep-work-phone" type="text" bind:value={workPhone} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-personal-phone">Personal phone</label>
          <input id="ep-personal-phone" type="text" bind:value={personalPhone} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-gov-phone">Government phone</label>
          <select id="ep-gov-phone" bind:value={govPhone}>
            <option value="">(not set)</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>
    </section>

    <section class="form-section">
      <h3>Organization and Project</h3>
      <div class="form-grid">
        <div class="field">
          <label for="ep-ipt">Integrated Product Team</label>
          <input id="ep-ipt" type="text" bind:value={team} maxlength="200" />
        </div>
        <div class="field">
          <label for="ep-ipt-lead">IPT Lead</label>
          <input id="ep-ipt-lead" type="text" bind:value={iptLead} maxlength="200" />
        </div>
        <div class="field">
          <label for="ep-project">Project</label>
          <input id="ep-project" type="text" bind:value={employeeProject} maxlength="200" />
        </div>
        <div class="field">
          <label for="ep-project-lead">Project Lead</label>
          <input id="ep-project-lead" type="text" bind:value={employeeProjectLead} maxlength="200" />
        </div>
      </div>
    </section>

    <section class="form-section">
      <h3>Assets and Requirements</h3>
      <div class="form-grid">
        <div class="field">
          <label for="ep-asset">Computer Asset</label>
          <select id="ep-asset" bind:value={computerAsset}>
            <option value="">(not set)</option>
            {#each COMPUTER_ASSET_OPTIONS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="ep-clearance">Clearance</label>
          <select id="ep-clearance" bind:value={clearance}>
            <option value="">(not set)</option>
            {#each CLEARANCE_OPTIONS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="ep-cswf-code">CSWF Code</label>
          <input id="ep-cswf-code" type="text" bind:value={cswfCode} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-cswf-level">CSWF Level</label>
          <input id="ep-cswf-level" type="text" bind:value={cswfLevel} maxlength="50" />
        </div>
        <div class="field">
          <label for="ep-financial">Financial Statement Required</label>
          <select id="ep-financial" bind:value={financialStatementRequired}>
            <option value="">(not set)</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div class="field">
          <label for="ep-drug-test">Drug Test Required</label>
          <select id="ep-drug-test" bind:value={drugTestRequired}>
            <option value="">(not set)</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div class="field">
          <label for="ep-telework-valid">Telework Agreement Valid Through</label>
          <input id="ep-telework-valid" type="date" bind:value={teleworkAgreementValidThrough} />
        </div>
      </div>
    </section>

    <div class="dialog-actions">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Dialog>

<style>
  .form-section {
    margin-top: 1.5rem;
  }

  .form-section:first-child {
    margin-top: .2rem;
  }

  /* Eyebrow-style section header, matching the app's table headers. */
  .form-section h3 {
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-muted);
    margin: 0 0 .85rem;
    padding-bottom: .4rem;
    border-bottom: 1px solid var(--border);
  }

  /* Container-responsive: columns follow the dialog's actual width, so the
     layout stays comfortable instead of cramming a fixed count into it. */
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: .5rem .9rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .field label {
    margin: 0 0 .25rem;
  }

  .field :is(input, select) {
    width: 100%;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: .5rem;
    margin-top: 1.6rem;
  }
</style>
