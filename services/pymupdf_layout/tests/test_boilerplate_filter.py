"""Synthetic controls for conservative line-level footer-boilerplate filtering."""

import main


def _line(text: str, bbox, size: float = 8.0) -> main.Line:
    return main.Line(text=text, bbox=bbox, spans=[main.Span(text=text, bbox=bbox, size=size, font="synthetic")])


def _page_with(block: main.Block) -> main.PageBlocks:
    body_line = _line("Ordinary article body establishes the page font.", (0.08, 0.20, 0.48, 0.22), 10.0)
    body = main.Block(blockId="1:0", bbox=body_line.bbox, lines=[body_line])
    return main.PageBlocks(pageNumber=1, width=600.0, height=800.0, blocks=[body, block], suspiciousGaps=[])


def _legal_footer(text: str = "1234-5678/© 2026 Example Press. Open access under the CC BY license.") -> main.Line:
    return _line(text, (0.08, 0.93, 0.78, 0.94), 7.0)


def test_prose_and_footer_in_same_block_keeps_prose_removes_footer():
    prose = _line("Article prose that must remain.", (0.08, 0.88, 0.46, 0.90), 10.0)
    footer = _legal_footer()
    block = main.Block(blockId="1:1", bbox=(0.08, 0.88, 0.78, 0.94), lines=[prose, footer])
    result = main._filter_block_lines_for_selection(_page_with(block), block, [prose, footer], prose)
    assert result == [prose]


def test_normal_prose_near_page_bottom_is_retained():
    prose = _line("Results continue near the bottom margin.", (0.08, 0.93, 0.72, 0.94), 7.0)
    block = main.Block(blockId="1:1", bbox=prose.bbox, lines=[prose])
    assert not main._is_probable_document_boilerplate_line(_page_with(block), block, prose)


def test_body_sentence_containing_copyright_is_retained():
    prose = _line("The study examines copyright policy in digital archives.", (0.08, 0.40, 0.72, 0.42), 10.0)
    block = main.Block(blockId="1:1", bbox=prose.bbox, lines=[prose])
    assert not main._is_probable_document_boilerplate_line(_page_with(block), block, prose)


def test_body_sentence_containing_elsevier_is_retained():
    prose = _line("The dataset was indexed using Elsevier metadata.", (0.08, 0.40, 0.72, 0.42), 10.0)
    block = main.Block(blockId="1:1", bbox=prose.bbox, lines=[prose])
    assert not main._is_probable_document_boilerplate_line(_page_with(block), block, prose)


def test_footer_geometry_without_multiple_legal_signals_is_retained():
    footnote = _line("1 Correspondence and affiliation details for the authors.", (0.08, 0.93, 0.78, 0.94), 7.0)
    block = main.Block(blockId="1:1", bbox=footnote.bbox, lines=[footnote])
    assert not main._is_probable_document_boilerplate_line(_page_with(block), block, footnote)


def test_multiple_article_lines_keep_only_final_boilerplate_out():
    first = _line("First valid article line.", (0.08, 0.86, 0.46, 0.88), 10.0)
    second = _line("Second valid article line.", (0.08, 0.89, 0.46, 0.91), 10.0)
    footer = _legal_footer()
    block = main.Block(blockId="1:1", bbox=(0.08, 0.86, 0.78, 0.94), lines=[first, second, footer])
    result = main._filter_block_lines_for_selection(_page_with(block), block, [first, second, footer], first)
    assert result == [first, second]


def test_selected_footer_line_is_never_deleted():
    footer = _legal_footer()
    block = main.Block(blockId="1:1", bbox=footer.bbox, lines=[footer])
    result = main._filter_block_lines_for_selection(_page_with(block), block, [footer], footer)
    assert result == [footer]


def test_license_word_alone_is_not_sufficient():
    prose = _line("The software license was evaluated in this experiment.", (0.08, 0.93, 0.78, 0.94), 7.0)
    block = main.Block(blockId="1:1", bbox=prose.bbox, lines=[prose])
    assert not main._is_probable_document_boilerplate_line(_page_with(block), block, prose)
