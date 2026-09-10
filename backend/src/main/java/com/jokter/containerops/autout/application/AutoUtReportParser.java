package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtReportItem;

import java.util.List;

public interface AutoUtReportParser {
    List<AutoUtReportItem> parse(byte[] report, String language, String plGroup);
}
