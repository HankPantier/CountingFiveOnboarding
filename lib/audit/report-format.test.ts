import { describe, expect, it } from 'vitest'
import { gradeWithModifier, safeHref, score10, tokenForScore } from './report-format'

describe('score10', () => {
  it('renders a 0–100 score on the 0–10 scale with one decimal', () => {
    expect(score10(82)).toBe('8.2')
    expect(score10(75)).toBe('7.5')
    expect(score10(100)).toBe('10.0')
    expect(score10(0)).toBe('0.0')
  })
  it('renders an em dash for null', () => {
    expect(score10(null)).toBe('—')
  })
  it('clamps out-of-range scores (defends against a regressed double-scale)', () => {
    expect(score10(330)).toBe('10.0')
    expect(score10(-5)).toBe('0.0')
  })
})

describe('gradeWithModifier', () => {
  it('maps scores to +/- letter grades', () => {
    expect(gradeWithModifier(98)).toBe('A+')
    expect(gradeWithModifier(93)).toBe('A')
    expect(gradeWithModifier(90)).toBe('A-')
    expect(gradeWithModifier(83)).toBe('B')
    expect(gradeWithModifier(77)).toBe('C+')
    expect(gradeWithModifier(70)).toBe('C-')
    expect(gradeWithModifier(60)).toBe('D-')
    expect(gradeWithModifier(59)).toBe('F')
    expect(gradeWithModifier(0)).toBe('F')
  })
  it('returns N/A for null', () => {
    expect(gradeWithModifier(null)).toBe('N/A')
  })
  it('clamps out-of-range scores', () => {
    expect(gradeWithModifier(330)).toBe('A+')
    expect(gradeWithModifier(-5)).toBe('F')
  })
})

describe('tokenForScore', () => {
  it('mirrors the grade-token thresholds', () => {
    expect(tokenForScore(85)).toBe('success')
    expect(tokenForScore(80)).toBe('success')
    expect(tokenForScore(75)).toBe('warning')
    expect(tokenForScore(69)).toBe('error')
    expect(tokenForScore(null)).toBe('muted')
  })
})

describe('safeHref', () => {
  it('passes through http/https URLs', () => {
    expect(safeHref('https://example.com/path')).toBe('https://example.com/path')
    expect(safeHref('http://example.com')).toBe('http://example.com')
  })

  it('neutralizes javascript: and other dangerous schemes', () => {
    expect(safeHref('javascript:alert(document.cookie)')).toBe('#')
    expect(safeHref('JavaScript:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
    expect(safeHref('vbscript:msgbox(1)')).toBe('#')
    expect(safeHref('not a url')).toBe('#')
  })
})
