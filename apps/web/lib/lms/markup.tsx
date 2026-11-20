import { parseMarkup, type Inline } from '@unoa/domain/learning';

// Renders the restricted markup as React elements: no HTML string is ever
// injected, so any tag typed by an author stays visible text.
function Inlines({ items }: { items: Inline[] }) {
  return <>{items.map((item, index) => {
    if (item.type === 'strong') return <strong key={index}>{item.value}</strong>;
    if (item.type === 'em') return <em key={index}>{item.value}</em>;
    if (item.type === 'code') return <code key={index}>{item.value}</code>;
    if (item.type === 'link') return <a key={index} href={item.href} rel="noopener noreferrer nofollow" target="_blank">{item.value}</a>;
    return <span key={index}>{item.value}</span>;
  })}</>;
}

export function Markup({ source }: { source: string }) {
  return (
    <div className="markup">
      {parseMarkup(source).map((block, index) => {
        if (block.type === 'heading') {
          const Tag = (`h${block.level + 1}`) as 'h3' | 'h4' | 'h5';
          return <Tag key={index}><Inlines items={block.inlines} /></Tag>;
        }
        if (block.type === 'list') return <ul key={index}>{block.items.map((item, at) => <li key={at}><Inlines items={item} /></li>)}</ul>;
        return <p key={index}><Inlines items={block.inlines} /></p>;
      })}
    </div>
  );
}
