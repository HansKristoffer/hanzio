/**
 * Simple State Machine - A lightweight state machine implementation
 *
 * This provides a generic state machine abstraction that can be used
 * for various workflows and business processes.
 */

/**
 * Type for validation result
 * - true: transition is valid
 * - string: transition is invalid with reason
 */
export type ValidationResult = true | string

/**
 * Type for validation function
 * @param context The context object containing data needed for validation
 * @param fromState The state transitioning from
 * @param toState The state transitioning to
 * @param action When validating a specific action, the action key (for per-action rules)
 */
export type ValidatorFn<
	TState extends string,
	TContext,
	TAction extends string = string
> = (
	context: TContext,
	fromState: TState,
	toState: TState,
	action?: TAction
) => Promise<ValidationResult> | ValidationResult

/**
 * Type for action handler function
 * @param context The context object containing data needed for validation
 * @param data Additional data passed to the action
 * @returns Result of executing the action
 */
export type ActionHandlerFn<TContext, TData = unknown, TResult = unknown> = (
	context: TContext,
	data: TData
) => Promise<TResult> | TResult

export type ActionDataMap<TAction extends string> = Record<TAction, unknown>
export type ActionResultMap<TAction extends string> = Record<TAction, unknown>
export type StateKey<TContext, TState extends string> = {
	[K in keyof TContext]: TContext[K] extends TState ? K : never
}[keyof TContext]

export type ActionExecutionResult<TState extends string, TResult = unknown> =
	| {
			success: true
			newState: TState
			result?: TResult
	  }
	| {
			success: false
			error: string
	  }

/**
 * Interface for state machine configuration
 */
export interface StateMachineConfig<
	TState extends string,
	TAction extends string,
	TContext,
	TActionDataMap extends ActionDataMap<TAction> = ActionDataMap<TAction>,
	TActionResultMap extends ActionResultMap<TAction> = ActionResultMap<TAction>
> {
	// Maps states to possible actions and their target states
	stateActionMap: Record<TState, Partial<Record<TAction, TState>>>

	// Maps states to allowed direct transitions
	stateTransitions: Record<TState, readonly TState[]>

	// Validation functions for specific states
	validators?: Partial<Record<TState, ValidatorFn<TState, TContext, TAction>>>

	// Global validator that runs for all transitions
	globalValidator?: ValidatorFn<TState, TContext, TAction>

	// Validators for specific actions, run after the global and state validators
	actionValidators?: Partial<
		Record<TAction, ValidatorFn<TState, TContext, TAction>>
	>

	// State returned by getInitialState(). Defaults to the first key of stateTransitions
	initialState?: TState

	// Called after a successful action (after its handler). Throwing fails the action
	onTransition?: (
		context: TContext,
		from: TState,
		to: TState,
		action: TAction
	) => void | Promise<void>

	// Write the new state into item[stateKey] after a successful action
	applyTransition?: boolean

	// Action handlers for each action
	actions?: {
		[K in TAction]?: ActionHandlerFn<
			TContext,
			TActionDataMap[K],
			TActionResultMap[K]
		>
	}
}

export type ValidateTransitionOptions<TAction extends string> = {
	action?: TAction
}

/**
 * Creates a simple state machine with validation capabilities
 */
export class SimpleStateMachine<
	TState extends string,
	TAction extends string,
	TContext,
	TActionDataMap extends ActionDataMap<TAction> = ActionDataMap<TAction>,
	TActionResultMap extends ActionResultMap<TAction> = ActionResultMap<TAction>
> {
	private config: StateMachineConfig<
		TState,
		TAction,
		TContext,
		TActionDataMap,
		TActionResultMap
	>
	private item: TContext
	private stateKey: StateKey<TContext, TState>

	constructor(
		config: StateMachineConfig<
			TState,
			TAction,
			TContext,
			TActionDataMap,
			TActionResultMap
		>,
		item: TContext,
		stateKey: StateKey<TContext, TState>
	) {
		this.config = config
		this.item = item
		this.stateKey = stateKey
	}

	getCurrentStatus(): TState {
		return this.item[this.stateKey] as TState
	}

	/**
	 * Get available actions for the current state with validation results
	 *
	 * @returns Map of actions to validation results
	 */
	async getAvailableActions(): Promise<
		Partial<Record<TAction, ValidationResult>>
	> {
		const actionsMap = this.config.stateActionMap[this.getCurrentStatus()] || {}
		const entries = (
			Object.entries(actionsMap) as [TAction, TState | undefined][]
		).filter((entry): entry is [TAction, TState] => !!entry[1])
		const results = await Promise.all(
			entries.map(([action, targetState]) =>
				this.validateTransition(targetState, { action })
			)
		)

		return Object.fromEntries(
			entries.map(([action], i) => [action, results[i]])
		) as Partial<Record<TAction, ValidationResult>>
	}

	/**
	 * Get all possible state transitions from the current state
	 *
	 * @returns Map of target states to validation results (true if any action to that state validates)
	 */
	async getPossibleTransitions(): Promise<
		Partial<Record<TState, ValidationResult>>
	> {
		const possibleTransitions =
			this.config.stateTransitions[this.getCurrentStatus()] || []
		const actionsMap = this.config.stateActionMap[this.getCurrentStatus()] || {}
		const results = await Promise.all(
			possibleTransitions.map(async (targetState) => {
				const actionsToTarget = (
					Object.entries(actionsMap) as [TAction, TState | undefined][]
				).filter(([, t]) => t === targetState)

				if (actionsToTarget.length === 0) {
					return this.validateTransition(targetState)
				}

				const rs = await Promise.all(
					actionsToTarget.map(([action]) =>
						this.validateTransition(targetState, { action })
					)
				)
				// true if any action validates, otherwise the last action's error
				return rs.includes(true) ? true : (rs[rs.length - 1] as string)
			})
		)

		return Object.fromEntries(
			possibleTransitions.map((targetState, i) => [targetState, results[i]])
		) as Partial<Record<TState, ValidationResult>>
	}

	/**
	 * Checks whether an action can be executed from the current state
	 *
	 * @returns true, or the reason the action is not allowed
	 */
	async canExecute(action: TAction): Promise<ValidationResult> {
		const actionsMap = this.config.stateActionMap[this.getCurrentStatus()]
		if (!actionsMap) {
			return `No actions defined for state '${this.getCurrentStatus()}'`
		}

		const targetState = actionsMap[action]
		if (!targetState) {
			return `Action '${action}' not allowed in state '${this.getCurrentStatus()}'`
		}

		return this.validateTransition(targetState, { action })
	}

	/**
	 * Executes an action with additional data
	 *
	 * @param action The action to execute
	 * @param data The data for the action
	 * @returns Promise with the execution result
	 */
	async executeAction<A extends TAction>(
		action: A,
		data: TActionDataMap[A]
	): Promise<ActionExecutionResult<TState, TActionResultMap[A]>> {
		const fromState = this.getCurrentStatus()
		const validationResult = await this.canExecute(action)
		if (validationResult !== true) {
			return { success: false, error: validationResult }
		}

		const targetState = this.config.stateActionMap[fromState][action] as TState

		try {
			const result = await this.config.actions?.[action]?.(this.item, data)
			await this.config.onTransition?.(
				this.item,
				fromState,
				targetState,
				action
			)
			if (this.config.applyTransition) {
				this.item[this.stateKey] = targetState as TContext[StateKey<
					TContext,
					TState
				>]
			}
			return { success: true, newState: targetState, result }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			}
		}
	}

	/**
	 * Validates a transition between states
	 *
	 * @param toState The state transitioning to
	 * @param options When validating a specific action, pass `action` for per-action rules
	 */
	async validateTransition(
		toState: TState,
		options?: ValidateTransitionOptions<TAction>
	): Promise<ValidationResult> {
		const action = options?.action

		// If states are the same, no transition is needed
		if (this.getCurrentStatus() === toState) return true

		// Check if transition is allowed in the state machine
		const allowedTransitions =
			this.config.stateTransitions[this.getCurrentStatus()] || []

		if (!allowedTransitions.includes(toState)) {
			return `Invalid transition from '${this.getCurrentStatus()}' to '${toState}'`
		}

		// Run global validator if provided
		if (this.config.globalValidator) {
			const globalResult = await this.config.globalValidator(
				this.item,
				this.getCurrentStatus(),
				toState,
				action
			)
			if (globalResult !== true) {
				return globalResult
			}
		}

		// Run state-specific validator if provided
		const stateValidator = this.config.validators?.[toState]
		if (stateValidator) {
			const stateResult = await stateValidator(
				this.item,
				this.getCurrentStatus(),
				toState,
				action
			)
			if (stateResult !== true) {
				return stateResult
			}
		}

		// Run action-specific validator if validating a specific action
		const actionValidator = action && this.config.actionValidators?.[action]
		if (actionValidator) {
			return await actionValidator(
				this.item,
				this.getCurrentStatus(),
				toState,
				action
			)
		}

		return true
	}

	/**
	 * Get all states in the state machine
	 */
	getStates(): TState[] {
		return Object.keys(this.config.stateTransitions) as TState[]
	}

	/**
	 * Get initial state of the state machine
	 * @returns The initial state
	 */
	getInitialState(): TState | undefined {
		return this.config.initialState ?? this.getStates()[0]
	}
}

/**
 * Defines a state machine config once and binds it to items on demand
 *
 * @example
 * const orderMachine = createStateMachine<Status, Action, Order>(config)
 * const machine = orderMachine.for(order, 'status')
 */
export function createStateMachine<
	TState extends string,
	TAction extends string,
	TContext,
	TActionDataMap extends ActionDataMap<TAction> = ActionDataMap<TAction>,
	TActionResultMap extends ActionResultMap<TAction> = ActionResultMap<TAction>
>(
	config: StateMachineConfig<
		TState,
		TAction,
		TContext,
		TActionDataMap,
		TActionResultMap
	>
) {
	return {
		config,
		for: (item: TContext, stateKey: StateKey<TContext, TState>) =>
			new SimpleStateMachine(config, item, stateKey)
	}
}
