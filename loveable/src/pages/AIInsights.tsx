
import React, { useState } from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, AlertTriangle, Target, Lightbulb, BarChart3, FileSearch, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AIInsights = () => {
  const [insights] = useState([
    {
      id: 1,
      type: "pattern",
      title: "Witness Credibility Pattern Detected",
      description: "Analysis shows inconsistencies in testimony timing across 3 depositions",
      confidence: 94,
      impact: "high",
      recommendation: "Focus cross-examination on time-related questions"
    },
    {
      id: 2,
      type: "risk",
      title: "Potential Liability Exposure",
      description: "Similar fact patterns found in 7 comparable cases with adverse outcomes",
      confidence: 87,
      impact: "critical",
      recommendation: "Consider early settlement negotiations"
    },
    {
      id: 3,
      type: "opportunity",
      title: "Favorable Precedent Identified",
      description: "Recent ruling in similar case supports your position",
      confidence: 91,
      impact: "medium",
      recommendation: "Cite Johnson v. TechCorp (2024) in motion"
    }
  ]);

  const [caseMetrics] = useState({
    totalCases: 156,
    successRate: 78,
    avgSettlement: "$2.4M",
    timeReduction: "65%"
  });

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      default: return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'pattern': return <Target className="w-5 h-5" />;
      case 'risk': return <AlertTriangle className="w-5 h-5" />;
      case 'opportunity': return <Lightbulb className="w-5 h-5" />;
      default: return <Brain className="w-5 h-5" />;
    }
  };

  return (
    <AuthenticatedLayout>
      <div className="p-6 pt-20 lg:pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <Brain className="w-8 h-8 text-[#5674BC]" />
              AI-Powered Legal Insights
            </h1>
            <p className="text-slate-600 dark:text-slate-300">Advanced analytics and predictive intelligence for your cases</p>
          </div>
          <Button className="bg-[#5674BC] hover:bg-[#4a65a7] text-white">
            <Zap className="w-4 h-4 mr-2" />
            Generate Report
          </Button>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Cases Analyzed</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{caseMetrics.totalCases}</p>
                </div>
                <FileSearch className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Success Rate</p>
                  <p className="text-2xl font-bold text-green-600">{caseMetrics.successRate}%</p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Avg Settlement</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{caseMetrics.avgSettlement}</p>
                </div>
                <BarChart3 className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Time Saved</p>
                  <p className="text-2xl font-bold text-blue-600">{caseMetrics.timeReduction}</p>
                </div>
                <Zap className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="patterns">Case Patterns</TabsTrigger>
            <TabsTrigger value="predictions">Predictions</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4">
            <div className="grid gap-4">
              {insights.map((insight) => (
                <Card key={insight.id} className="border-l-4 border-l-[#5674BC]">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {getTypeIcon(insight.type)}
                        <div>
                          <CardTitle className="text-lg">{insight.title}</CardTitle>
                          <CardDescription className="mt-1">{insight.description}</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getImpactColor(insight.impact)}>
                          {insight.impact.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">
                          {insight.confidence}% confidence
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                      <p className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-1">
                        🎯 AI Recommendation:
                      </p>
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        {insight.recommendation}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="patterns" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Identified Patterns</CardTitle>
                <CardDescription>AI-detected patterns across your case portfolio</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <h3 className="font-medium text-slate-900 dark:text-white mb-2">Settlement Timing Pattern</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                      Cases settled within 60 days of expert witness deposition have 23% higher settlement values
                    </p>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                      Actionable Insight
                    </Badge>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <h3 className="font-medium text-slate-900 dark:text-white mb-2">Witness Credibility Markers</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                      Specific language patterns in depositions correlate with jury verdicts in 89% of cases
                    </p>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                      Predictive Model
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="predictions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Case Outcome Predictions</CardTitle>
                <CardDescription>AI-powered predictions based on similar cases and current evidence</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Smith v. TechCorp Settlement Prediction</h3>
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">85% Confidence</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">$1.2M - $1.8M</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Predicted Range</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">45-60 days</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Time to Resolution</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">78%</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Favorable Outcome</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AuthenticatedLayout>
  );
};

export default AIInsights;
