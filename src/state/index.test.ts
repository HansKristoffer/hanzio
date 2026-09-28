import { describe, expect, test } from 'bun:test'
import {
	SimpleStateMachine,
	type StateMachineConfig,
	createStateMachine
} from '.'

type S = 'A' | 'B' | 'C'
type Act = 'toB' | 'toC' | 'toCAlt'

describe('SimpleStateMachine action-aware validation', () => {
	test('getAvailableActions validates each action with the correct action key', async () => {
		const sm = new SimpleStateMachine<
			S,
			Act,
			{ status: S },
			Record<Act, Record<string, never>>
		>(
			{
				stateActionMap: {
					A: { toB: 'B', toC: 'C', toCAlt: 'C' },
					B: {},
					C: {}
				},
				stateTransitions: {
					A: ['B', 'C'],
					B: [],
					C: []
				},
				validators: {
					B: (_ctx, _from, _to, action) =>
						action === 'toB' ? true : 'wrong action for B',
					C: (_ctx, _from, _to, action) =>
						action === 'toCAlt' ? true : 'need alt path'
				}
			},
			{ status: 'A' },
			'status'
		)

		const actions = await sm.getAvailableActions()
		expect(actions.toB).toBe(true)
		expect(actions.toC).toBe('need alt path')
		expect(actions.toCAlt).toBe(true)
	})

	test('getPossibleTransitions is true if any action to that state validates', async () => {
		const sm = new SimpleStateMachine<
			S,
			Act,
			{ status: S },
			Record<Act, Record<string, never>>
		>(
			{
				stateActionMap: {
					A: { toB: 'B', toC: 'C', toCAlt: 'C' },
					B: {},
					C: {}
				},
				stateTransitions: {
					A: ['B', 'C'],
					B: [],
					C: []
				},
				validators: {
					B: () => true,
					C: (_ctx, _from, _to, action) =>
						action === 'toCAlt' ? true : 'strict'
				}
			},
			{ status: 'A' },
			'status'
		)

		const transitions = await sm.getPossibleTransitions()
		expect(transitions.B).toBe(true)
		expect(transitions.C).toBe(true)
	})

	test('executeAction passes action into validation', async () => {
		const sm = new SimpleStateMachine<
			S,
			Act,
			{ status: S },
			Record<Act, Record<string, never>>,
			Record<Act, { ok: boolean }>
		>(
			{
				stateActionMap: {
					A: { toCAlt: 'C' },
					B: {},
					C: {}
				},
				stateTransitions: {
					A: ['C'],
					B: [],
					C: []
				},
				validators: {
					C: (_ctx, _from, _to, action) => (action === 'toCAlt' ? true : 'no')
				},
				actions: {
					toCAlt: async () => ({ ok: true })
				}
			},
			{ status: 'A' },
			'status'
		)

		const r = await sm.executeAction('toCAlt', {})
		expect(r.success).toBe(true)
		if (r.success) {
			const typedResult: { ok: boolean } | undefined = r.result
			expect(typedResult).toEqual({ ok: true })
		}
	})

	test('state key must point to a state value', () => {
		const config = {
			stateActionMap: {
				A: { toB: 'B' },
				B: {},
				C: {}
			},
			stateTransitions: {
				A: ['B'],
				B: [],
				C: []
			}
		} satisfies import('.').StateMachineConfig<
			S,
			Act,
			{ status: S; label: string },
			Record<Act, Record<string, never>>
		>

		new SimpleStateMachine<
			S,
			Act,
			{ status: S; label: string },
			Record<Act, Record<string, never>>
		>(config, { status: 'A', label: 'Name' }, 'status')

		new SimpleStateMachine<
			S,
			Act,
			{ status: S; label: string },
			Record<Act, Record<string, never>>
			// @ts-expect-error stateKey must reference a property containing the state union.
		>(config, { status: 'A', label: 'Name' }, 'label')
	})
})

type Item = { status: S }
type Data = Record<Act, Record<string, never>>

const baseConfig = {
	stateActionMap: {
		A: { toB: 'B', toC: 'C' },
		B: { toC: 'C' },
		C: {}
	},
	stateTransitions: {
		A: ['B', 'C'],
		B: ['C'],
		C: []
	}
} satisfies StateMachineConfig<S, Act, Item, Data>

describe('SimpleStateMachine transitions', () => {
	test('applyTransition writes the new state and onTransition receives from/to/action', async () => {
		const calls: unknown[] = []
		const item: Item = { status: 'A' }
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			{
				...baseConfig,
				applyTransition: true,
				onTransition: async (ctx, from, to, action) => {
					calls.push([ctx.status, from, to, action])
				}
			},
			item,
			'status'
		)

		const r = await sm.executeAction('toB', {})
		expect(r).toEqual({ success: true, newState: 'B', result: undefined })
		expect(calls).toEqual([['A', 'A', 'B', 'toB']])
		expect(item.status).toBe('B')
		expect(sm.getCurrentStatus()).toBe('B')
	})

	test('state is left unchanged without applyTransition', async () => {
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			baseConfig,
			{ status: 'A' },
			'status'
		)

		await sm.executeAction('toB', {})
		expect(sm.getCurrentStatus()).toBe('A')
	})

	test('onTransition errors fail the action and do not apply the state', async () => {
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			{
				...baseConfig,
				applyTransition: true,
				onTransition: () => {
					throw new Error('persist failed')
				}
			},
			{ status: 'A' },
			'status'
		)

		expect(await sm.executeAction('toB', {})).toEqual({
			success: false,
			error: 'persist failed'
		})
		expect(sm.getCurrentStatus()).toBe('A')
	})

	test('initialState overrides the first-key fallback', () => {
		const item: Item = { status: 'A' }
		expect(
			new SimpleStateMachine<S, Act, Item, Data>(
				baseConfig,
				item,
				'status'
			).getInitialState()
		).toBe('A')
		expect(
			new SimpleStateMachine<S, Act, Item, Data>(
				{ ...baseConfig, initialState: 'B' },
				item,
				'status'
			).getInitialState()
		).toBe('B')
	})

	test('actionValidators run after global and state validators', async () => {
		const order: string[] = []
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			{
				...baseConfig,
				globalValidator: () => {
					order.push('global')
					return true
				},
				validators: {
					C: () => {
						order.push('state')
						return true
					}
				},
				actionValidators: {
					toC: (_ctx, from, to, action) => {
						order.push(`action:${action}:${from}->${to}`)
						return 'blocked by action'
					}
				}
			},
			{ status: 'A' },
			'status'
		)

		expect(await sm.canExecute('toC')).toBe('blocked by action')
		expect(order).toEqual(['global', 'state', 'action:toC:A->C'])
		expect(await sm.canExecute('toB')).toBe(true)
		// Without an action, action validators are skipped
		expect(await sm.validateTransition('C')).toBe(true)
		expect(await sm.executeAction('toC', {})).toEqual({
			success: false,
			error: 'blocked by action'
		})
	})

	test('canExecute rejects actions not allowed in the current state', async () => {
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			baseConfig,
			{ status: 'B' },
			'status'
		)

		expect(await sm.canExecute('toB')).toBe(
			"Action 'toB' not allowed in state 'B'"
		)
		expect(await sm.canExecute('toC')).toBe(true)
	})

	test('getAvailableActions runs validators in parallel and keeps key order', async () => {
		let running = 0
		let maxRunning = 0
		const slow = async () => {
			running++
			maxRunning = Math.max(maxRunning, running)
			await Bun.sleep(5)
			running--
			return true as const
		}
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			{ ...baseConfig, validators: { B: slow, C: slow } },
			{ status: 'A' },
			'status'
		)

		const actions = await sm.getAvailableActions()
		expect(Object.keys(actions)).toEqual(['toB', 'toC'])
		expect(maxRunning).toBe(2)

		maxRunning = 0
		const transitions = await sm.getPossibleTransitions()
		expect(Object.keys(transitions)).toEqual(['B', 'C'])
		expect(maxRunning).toBe(2)
	})

	test('getPossibleTransitions returns the last error when no action validates', async () => {
		const sm = new SimpleStateMachine<S, Act, Item, Data>(
			{
				stateActionMap: { A: { toC: 'C', toCAlt: 'C' }, B: {}, C: {} },
				stateTransitions: { A: ['C'], B: [], C: [] },
				actionValidators: {
					toC: () => 'first',
					toCAlt: () => 'second'
				}
			},
			{ status: 'A' },
			'status'
		)

		expect(await sm.getPossibleTransitions()).toEqual({ C: 'second' })
	})
})

describe('createStateMachine', () => {
	test('binds one config to many items', async () => {
		const machine = createStateMachine<S, Act, Item, Data>({
			...baseConfig,
			applyTransition: true
		})
		const first: Item = { status: 'A' }
		const second: Item = { status: 'B' }

		expect(machine.config.stateTransitions.A).toEqual(['B', 'C'])
		expect(machine.for(first, 'status')).toBeInstanceOf(SimpleStateMachine)

		await machine.for(first, 'status').executeAction('toB', {})
		await machine.for(second, 'status').executeAction('toC', {})
		expect(first.status).toBe('B')
		expect(second.status).toBe('C')
	})

	test('stateKey must point to a state value', () => {
		const machine = createStateMachine<
			S,
			Act,
			{ status: S; label: string },
			Data
		>(baseConfig)

		machine.for({ status: 'A', label: 'x' }, 'status')
		// @ts-expect-error stateKey must reference a property containing the state union.
		machine.for({ status: 'A', label: 'x' }, 'label')
	})
})
