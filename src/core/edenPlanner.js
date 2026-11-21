
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

class EdenPlanner {
  constructor(memoryDirectory) {
    if (!memoryDirectory) {
      throw new Error('EDEN Planner requires a memory directory.');
    }

    this.memoryDirectory = memoryDirectory;
    this.file = path.join(memoryDirectory, 'plans.json');
    this.plans = [];
    this.initialized = false;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.promises.mkdir(this.memoryDirectory, {
      recursive: true
    });

    let data;
    let createInitialFile = false;

    try {
      const raw = await fs.promises.readFile(
        this.file,
        'utf8'
      );

      data = JSON.parse(raw);

      if (
        data.version !== 1 ||
        !Array.isArray(data.plans)
      ) {
        throw new Error(
          'Unsupported or invalid EDEN plans file.'
        );
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(
          `EDEN Planner could not load plans: ${error.message}`
        );
      }

      data = {
        version: 1,
        plans: []
      };

      createInitialFile = true;
    }

    // Create the database only when it does not already exist.
    // Never overwrite an existing planning database during recovery.
    if (createInitialFile) {
      const temporaryFile =
        `${this.file}.${randomUUID()}.tmp`;

      try {
        await fs.promises.writeFile(
          temporaryFile,
          JSON.stringify(data, null, 2),
          'utf8'
        );

        await fs.promises.rename(
          temporaryFile,
          this.file
        );

      } catch (writeError) {
        await fs.promises.unlink(temporaryFile).catch(() => {});
        throw writeError;
      }
    }

    this.plans = data.plans;
    this.initialized = true;

    console.log(
      `EDEN: Planner initialized. Plans loaded: ${this.plans.length}`
    );

    return true;
  }

  ensureReady() {
    if (!this.initialized) {
      throw new Error('EDEN Planner is not initialized.');
    }
  }

  async save() {
    this.ensureReady();

    const snapshot = JSON.stringify({
      version: 1,
      plans: this.plans
    }, null, 2);

    // Serialize writes to prevent older snapshots overwriting newer ones.
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const temporaryFile =
          `${this.file}.${randomUUID()}.tmp`;

        try {
          await fs.promises.writeFile(
            temporaryFile,
            snapshot,
            'utf8'
          );

          await fs.promises.rename(
            temporaryFile,
            this.file
          );

        } catch (error) {
          await fs.promises.unlink(temporaryFile).catch(() => {});
          throw error;
        }
      });

    await this.writeQueue;
  }

  findPlan(planId) {
    return this.plans.find(plan => plan.id === planId) || null;
  }

  findStep(plan, stepId) {
    return plan.steps.find(step => step.id === stepId) || null;
  }

  copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  record(plan, event, details = {}) {
    plan.audit.push({
      id: randomUUID(),
      event,
      details,
      at: new Date().toISOString()
    });

    plan.audit = plan.audit.slice(-200);
    plan.updatedAt = new Date().toISOString();
  }

  validateDependencies(steps) {
    const known = new Set(steps.map(step => step.id));
    const visiting = new Set();
    const visited = new Set();

    for (const step of steps) {
      for (const dependency of step.dependsOn) {
        if (!known.has(dependency)) {
          throw new Error(
            `Unknown dependency "${dependency}" in ${step.id}.`
          );
        }

        if (dependency === step.id) {
          throw new Error(
            `${step.id} cannot depend on itself.`
          );
        }
      }
    }

    const visit = stepId => {
      if (visiting.has(stepId)) {
        throw new Error(
          'Plan dependencies contain a circular dependency.'
        );
      }

      if (visited.has(stepId)) return;

      visiting.add(stepId);

      const step = steps.find(item => item.id === stepId);

      for (const dependency of step.dependsOn) {
        visit(dependency);
      }

      visiting.delete(stepId);
      visited.add(stepId);
    };

    for (const step of steps) {
      visit(step.id);
    }
  }

  async createPlan(input) {
    this.ensureReady();

    if (!input || typeof input !== 'object') {
      throw new Error('A plan definition is required.');
    }

    const title = String(input.title || '').trim();
    const goal = String(input.goal || '').trim();
    const summary = String(input.summary || '').trim();

    if (!title || !goal) {
      throw new Error('A plan needs a title and a goal.');
    }

    if (title.length > 160 || goal.length > 1000) {
      throw new Error('Plan title or goal is too long.');
    }

    if (
      !Array.isArray(input.steps) ||
      input.steps.length < 1 ||
      input.steps.length > 25
    ) {
      throw new Error(
        'A plan must contain between 1 and 25 steps.'
      );
    }

    const steps = input.steps.map((source, index) => {
      const stepTitle = String(source?.title || '').trim();

      const description = String(
        source?.description || ''
      ).trim();

      if (!stepTitle) {
        throw new Error(`Step ${index + 1} needs a title.`);
      }

      const risk = ['low', 'medium', 'high'].includes(
        source.risk
      ) ? source.risk : 'medium';

      const id = `step-${String(index + 1).padStart(2, '0')}`;

      const dependsOn = Array.isArray(source.dependsOn)
        ? source.dependsOn.map(dependency => {
            if (Number.isInteger(dependency)) {
              return `step-${String(dependency).padStart(2, '0')}`;
            }

            return String(dependency);
          })
        : [];

      return {
        id,
        title: stepTitle.slice(0, 160),
        description: description.slice(0, 1000),
        dependsOn: [...new Set(dependsOn)],
        risk,

        requiresApproval:
          typeof source.requiresApproval === 'boolean'
            ? source.requiresApproval
            : risk !== 'low',

        approvalGranted: false,
        status: 'pending',
        verificationNote: '',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null
      };
    });

    this.validateDependencies(steps);

    const now = new Date().toISOString();

    const plan = {
      id: `plan-${randomUUID()}`,
      title: title.slice(0, 160),
      goal: goal.slice(0, 1000),
      summary: summary.slice(0, 2000),
      status: 'draft',
      requiresApproval: true,
      approvedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      steps,
      audit: []
    };

    this.record(plan, 'plan-created', {
      stepCount: steps.length
    });

    this.plans.unshift(plan);

    try {
      await this.save();
      return this.copy(plan);

    } catch (error) {
      this.plans.shift();
      throw error;
    }
  }

  listPlans() {
    this.ensureReady();

    return this.plans.map(plan => ({
      id: plan.id,
      title: plan.title,
      goal: plan.goal,
      status: plan.status,
      totalSteps: plan.steps.length,

      completedSteps: plan.steps.filter(
        step => step.status === 'completed'
      ).length,

      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }));
  }

  getPlan(planId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    return plan ? this.copy(plan) : null;
  }

  async approvePlan(planId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== 'draft') {
      throw new Error('Only draft plans can be approved.');
    }

    plan.approvedAt = new Date().toISOString();
    plan.status = 'approved';

    this.record(plan, 'plan-approved');

    await this.save();
    return this.copy(plan);
  }

  async startPlan(planId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== 'approved') {
      throw new Error(
        'The plan must be approved before it can start.'
      );
    }

    plan.status = 'active';
    plan.startedAt = new Date().toISOString();

    this.record(plan, 'plan-started');

    await this.save();
    return this.copy(plan);
  }

  getReadySteps(planId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== 'active') return [];

    return plan.steps
      .filter(step => step.status === 'pending')
      .filter(step =>
        step.dependsOn.every(dependency =>
          this.findStep(plan, dependency)?.status === 'completed'
        )
      )
      .map(step => ({
        ...this.copy(step),

        readiness: (
          step.requiresApproval && !step.approvalGranted
        ) ? 'waiting-for-approval' : 'ready'
      }));
  }

  async approveStep(planId, stepId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (!['approved', 'active'].includes(plan.status)) {
      throw new Error('Approve the plan first.');
    }

    const step = this.findStep(plan, stepId);

    if (!step) throw new Error('Plan step not found.');

    if (step.status !== 'pending') {
      throw new Error('Only pending steps can be approved.');
    }

    if (step.approvalGranted) {
      return this.copy(step);
    }

    step.approvalGranted = true;

    this.record(plan, 'step-approved', { stepId });

    await this.save();
    return this.copy(step);
  }

  async markStepInProgress(planId, stepId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== 'active') {
      throw new Error('The plan is not active.');
    }

    const step = this.findStep(plan, stepId);

    if (!step) throw new Error('Plan step not found.');

    if (step.status !== 'pending') {
      throw new Error('This step is not pending.');
    }

    const dependenciesComplete = step.dependsOn.every(
      dependency =>
        this.findStep(plan, dependency)?.status === 'completed'
    );

    if (!dependenciesComplete) {
      throw new Error('This step has unfinished dependencies.');
    }

    if (step.requiresApproval && !step.approvalGranted) {
      throw new Error('This step requires explicit approval.');
    }

    step.status = 'in-progress';
    step.startedAt = new Date().toISOString();

    this.record(plan, 'step-started', { stepId });

    await this.save();
    return this.copy(step);
  }

  async completeStep(planId, stepId, verificationNote) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== 'active') {
      throw new Error('The plan is not active.');
    }

    const step = this.findStep(plan, stepId);

    if (!step) throw new Error('Plan step not found.');

    if (step.status !== 'in-progress') {
      throw new Error(
        'A step must be in progress before completion.'
      );
    }

    const evidence = String(
      verificationNote || ''
    ).trim();

    if (!evidence) {
      throw new Error(
        'Completion requires a verification note.'
      );
    }

    step.status = 'completed';
    step.verificationNote = evidence.slice(0, 1000);
    step.completedAt = new Date().toISOString();

    this.record(plan, 'step-completed', {
      stepId,
      verificationNote: step.verificationNote
    });

    if (plan.steps.every(item => item.status === 'completed')) {
      plan.status = 'completed';
      plan.completedAt = new Date().toISOString();

      this.record(plan, 'plan-completed');
    }

    await this.save();
    return this.copy(plan);
  }

  async pausePlan(planId) {
    return this.changePlanStatus(
      planId,
      'active',
      'paused',
      'plan-paused'
    );
  }

  async resumePlan(planId) {
    return this.changePlanStatus(
      planId,
      'paused',
      'active',
      'plan-resumed'
    );
  }

  async cancelPlan(planId) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (['completed', 'cancelled'].includes(plan.status)) {
      throw new Error('This plan is already finished.');
    }

    const previous = plan.status;
    plan.status = 'cancelled';

    this.record(plan, 'plan-cancelled', {
      previousStatus: previous
    });

    await this.save();
    return this.copy(plan);
  }

  async changePlanStatus(planId, expected, next, event) {
    this.ensureReady();

    const plan = this.findPlan(planId);

    if (!plan) throw new Error('Plan not found.');

    if (plan.status !== expected) {
      throw new Error(
        `Cannot change plan from ${plan.status} to ${next}.`
      );
    }

    plan.status = next;

    this.record(plan, event);

    await this.save();
    return this.copy(plan);
  }
}

module.exports = EdenPlanner;
