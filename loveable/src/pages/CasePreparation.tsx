
import React, { useState } from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  Users, 
  Calendar, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Briefcase,
  Target,
  BookOpen,
  Scale,
  Plus
} from "lucide-react";

const CasePreparation = () => {
  const [activeCases] = useState([
    {
      id: 1,
      title: "Smith v. TechCorp Industries",
      type: "Personal Injury",
      phase: "Discovery",
      priority: "high",
      dueDate: "2024-07-15",
      completion: 75,
      teamMembers: ["Sarah J.", "Michael C.", "Emily R."],
      lastActivity: "Expert witness deposition scheduled"
    },
    {
      id: 2,
      title: "Johnson Medical Malpractice",
      type: "Medical Malpractice",
      phase: "Trial Prep",
      priority: "critical",
      dueDate: "2024-07-08",
      completion: 90,
      teamMembers: ["Sarah J.", "David L."],
      lastActivity: "Trial brief filed"
    },
    {
      id: 3,
      title: "Estate Planning - Williams",
      type: "Estate Planning",
      phase: "Documentation",
      priority: "medium",
      dueDate: "2024-07-22",
      completion: 45,
      teamMembers: ["Emily R.", "Robert K."],
      lastActivity: "Asset valuation completed"
    }
  ]);

  const [caseTemplates] = useState([
    {
      id: 1,
      name: "Personal Injury Discovery",
      description: "Complete discovery template with document requests, interrogatories, and deposition outlines",
      usage: 156,
      categories: ["Discovery", "Personal Injury"]
    },
    {
      id: 2,
      name: "Medical Malpractice Case Prep",
      description: "Comprehensive case preparation including expert witness coordination and medical record analysis",
      usage: 89,
      categories: ["Medical", "Expert Witnesses"]
    },
    {
      id: 3,
      name: "Corporate Litigation Workflow",
      description: "End-to-end workflow for corporate disputes including document preservation and discovery",
      usage: 134,
      categories: ["Corporate", "Litigation"]
    }
  ]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      default: return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    }
  };

  return (
    <AuthenticatedLayout>
      <div className="p-6 pt-20 lg:pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <Briefcase className="w-8 h-8 text-[#5674BC]" />
              Case Preparation Center
            </h1>
            <p className="text-slate-600 dark:text-slate-300">Streamline your case preparation with AI-powered workflows</p>
          </div>
          <Button className="bg-[#5674BC] hover:bg-[#4a65a7] text-white">
            <Plus className="w-4 h-4 mr-2" />
            New Case
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Active Cases</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">12</p>
                </div>
                <Briefcase className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Due This Week</p>
                  <p className="text-2xl font-bold text-orange-600">5</p>
                </div>
                <Clock className="w-8 h-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Completed</p>
                  <p className="text-2xl font-bold text-green-600">28</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Team Members</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">8</p>
                </div>
                <Users className="w-8 h-8 text-[#5674BC]" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="active-cases" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active-cases">Active Cases</TabsTrigger>
            <TabsTrigger value="templates">Case Templates</TabsTrigger>
            <TabsTrigger value="resources">Legal Resources</TabsTrigger>
          </TabsList>

          <TabsContent value="active-cases" className="space-y-4">
            <div className="grid gap-4">
              {activeCases.map((caseItem) => (
                <Card key={caseItem.id} className="border-l-4 border-l-[#5674BC]">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{caseItem.title}</CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">{caseItem.type}</Badge>
                          <Badge variant="outline">{caseItem.phase}</Badge>
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getPriorityColor(caseItem.priority)}>
                          {caseItem.priority.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">
                          Due: {new Date(caseItem.dueDate).toLocaleDateString()}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Progress Bar */}
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-600 dark:text-slate-300">Progress</span>
                          <span className="font-medium text-slate-900 dark:text-white">{caseItem.completion}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                          <div 
                            className="bg-[#5674BC] h-2 rounded-full transition-all duration-300"
                            style={{ width: `${caseItem.completion}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Team and Activity */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                          <span className="text-sm text-slate-600 dark:text-slate-300">
                            {caseItem.teamMembers.join(", ")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                          <span className="text-sm text-slate-600 dark:text-slate-300">
                            {caseItem.lastActivity}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm">
                          <FileText className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                        <Button variant="outline" size="sm">
                          <Calendar className="w-4 h-4 mr-2" />
                          Schedule
                        </Button>
                        <Button variant="outline" size="sm">
                          <Users className="w-4 h-4 mr-2" />
                          Collaborate
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {caseTemplates.map((template) => (
                <Card key={template.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <BookOpen className="w-8 h-8 text-[#5674BC]" />
                      <Badge variant="secondary">{template.usage} uses</Badge>
                    </div>
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <CardDescription className="text-sm">{template.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1">
                        {template.categories.map((category, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {category}
                          </Badge>
                        ))}
                      </div>
                      <Button className="w-full bg-[#5674BC] hover:bg-[#4a65a7] text-white">
                        Use Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="resources" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="w-5 h-5" />
                    Legal Research Tools
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full justify-start">
                    <Target className="w-4 h-4 mr-2" />
                    Case Law Database
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <BookOpen className="w-4 h-4 mr-2" />
                    Statute Finder
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <FileText className="w-4 h-4 mr-2" />
                    Form Library
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    Compliance Checklist
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Document retention policies</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Client confidentiality measures</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="text-sm">Statute of limitations tracking</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AuthenticatedLayout>
  );
};

export default CasePreparation;
