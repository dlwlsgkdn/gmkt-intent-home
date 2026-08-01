import React from 'react'
import { Img, kText } from './support.jsx'

/* 공통 콘텐츠 컴포넌트 — 어느 단계에나 놓을 수 있는 텍스트·안내·이미지 */
export const COMMON_COMPONENTS = {
  textBlock: {
    label: '텍스트 블록',
    stage: 'common',
    icon: '📝',
    hint: '자유 텍스트 (키커/제목/본문)',
    defaults: { kicker: 'Note', title: '섹션 제목', body: '본문 내용을 입력하세요.' },
    fields: [
      { key: 'kicker', label: '키커', kind: 'text' },
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'body', label: '본문', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="sb-static">
        {p.kicker ? <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 block mb-2">{kText(p.kicker, ctx, 'kicker')}</span> : null}
        {p.title ? <h3 className="text-xl font-semibold text-slate-900 mb-2">{kText(p.title, ctx, 'title')}</h3> : null}
        {p.body ? <p className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{kText(p.body, ctx, 'body')}</p> : null}
      </div>
    ),
  },

  noticeCard: {
    label: '안내 카드',
    stage: 'common',
    icon: '📌',
    hint: '점선 테두리 안내 박스',
    defaults: { title: '안내', body: '상품을 보고 담기를 누르면 목적별로 모아볼 수 있어요.' },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'body', label: '내용', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-5 text-sm leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-700 mb-1">{kText(p.title, ctx, 'title')}</p>
        <p className="whitespace-pre-wrap">{kText(p.body, ctx, 'body')}</p>
      </div>
    ),
  },

  imageCard: {
    label: '이미지 카드',
    stage: 'common',
    icon: '🌄',
    hint: '단독 이미지 + 캡션',
    defaults: { imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif', caption: '' },
    fields: [
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
      { key: 'caption', label: '캡션', kind: 'text' },
    ],
    render: (p, ctx) => (
      <figure className="sb-static">
        <div className="rounded-[28px] overflow-hidden border border-slate-100 shadow-sm bg-slate-50 sb-image-card">
          <Img src={p.imageUrl} alt={p.caption} />
        </div>
        {p.caption ? <figcaption className="mt-2 text-xs text-slate-400 text-center">{kText(p.caption, ctx, 'caption')}</figcaption> : null}
      </figure>
    ),
  },
}
