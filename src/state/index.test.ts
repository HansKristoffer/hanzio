import { describe, expect, test } from 'bun:test'
import { SimpleStateMachine } from '.'

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
