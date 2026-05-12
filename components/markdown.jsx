import MarkdownToJsx from 'markdown-to-jsx';
import { CodeBlock } from './code-block';

export function Markdown({ content, className }) {
    const HighlightedCodeBlock = ({ children }) => {
        const { props } = children;
        const matchLanguage = /lang-(\w+)/.exec(props?.className || '');
        return (
            <CodeBlock
                code={props?.children}
                lang={matchLanguage ? matchLanguage[1] : undefined}
                title={props?.title}
            />
        );
    };

    return (
        <MarkdownToJsx
            className={['markdown', className].filter(Boolean).join(' ')}
            options={{
                forceBlock: true,
                overrides: {
                    pre: HighlightedCodeBlock,
                    ul: { props: { className: 'list-disc pl-6 space-y-2' } },
                    ol: { props: { className: 'list-decimal pl-6 space-y-2' } },
                    li: { props: { className: 'pl-1' } }
                }
            }}
        >
            {content}
        </MarkdownToJsx>
    );
}
